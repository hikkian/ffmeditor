package metrics

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SystemSnapshot holds a point-in-time system resource reading.
type SystemSnapshot struct {
	Timestamp    time.Time `json:"timestamp"`
	CPUPercent   float64   `json:"cpu_percent"`    // -1 if unavailable
	RAMUsedMB    float64   `json:"ram_used_mb"`
	RAMTotalMB   float64   `json:"ram_total_mb"`
	RAMPercent   float64   `json:"ram_percent"`
	ProcMemoryMB float64   `json:"proc_memory_mb"` // Go process heap alloc
	GPU          *GPUInfo  `json:"gpu,omitempty"`
}

// GPUInfo holds NVIDIA GPU metrics obtained via nvidia-smi.
type GPUInfo struct {
	Name         string  `json:"name"`
	UsedMB       float64 `json:"used_mb"`
	TotalMB      float64 `json:"total_mb"`
	UtilPercent  float64 `json:"util_percent"`
	TempC        float64 `json:"temperature_c,omitempty"`
}

// PeriodMetrics aggregates snapshots taken during an operation window.
type PeriodMetrics struct {
	AvgCPU   float64
	PeakCPU  float64
	AvgRAM   float64
	PeakRAM  float64
	AvgGPU   float64
	PeakGPU  float64
	GPUAvail bool
	Samples  int
}

// OperationRecord is written to JSONL after each FFmpeg operation completes.
type OperationRecord struct {
	ID                string    `json:"operation_id"`
	JobID             string    `json:"job_id"`
	Timestamp         time.Time `json:"timestamp"`
	Operation         string    `json:"operation"` // convert | merge | timeline
	InputFile         string    `json:"input_file,omitempty"`
	InputSizeMB       float64   `json:"input_size_mb"`
	InputDurationSec  float64   `json:"input_duration_sec"`
	OutputSizeMB      float64   `json:"output_size_mb"`
	ProcessingTimeSec float64   `json:"processing_time_sec"`
	SpeedRatio        float64   `json:"speed_ratio"` // input_duration / processing_time
	AvgCPUPercent     float64   `json:"avg_cpu_percent"`
	PeakCPUPercent    float64   `json:"peak_cpu_percent"`
	AvgRAMMB          float64   `json:"avg_ram_mb"`
	PeakRAMMB         float64   `json:"peak_ram_mb"`
	GPUAvailable      bool      `json:"gpu_available"`
	AvgGPUPercent     float64   `json:"avg_gpu_percent,omitempty"`
	FFmpegSpeed       float64   `json:"ffmpeg_speed"` // FFmpeg-reported speed multiplier
	FFmpegFPS         float64   `json:"ffmpeg_fps"`
	FFmpegBitrateKbps float64   `json:"ffmpeg_bitrate_kbps"`
	Success           bool      `json:"success"`
	ErrorMessage      string    `json:"error,omitempty"`
	OutputFormat      string    `json:"output_format,omitempty"`
	VideoCodec        string    `json:"video_codec,omitempty"`
	AudioCodec        string    `json:"audio_codec,omitempty"`
}

// Summary is returned by GET /metrics/summary.
type Summary struct {
	TotalOperations    int     `json:"total_operations"`
	SuccessCount       int     `json:"success_count"`
	FailureCount       int     `json:"failure_count"`
	SuccessRate        float64 `json:"success_rate_percent"`
	AvgProcessingTime  float64 `json:"avg_processing_time_sec"`
	AvgCPUPercent      float64 `json:"avg_cpu_percent"`
	PeakRAMMB          float64 `json:"peak_ram_mb"`
	AvgSpeedRatio      float64 `json:"avg_speed_ratio"`
	AvgCompressionPct  float64 `json:"avg_compression_pct"` // output/input size * 100
	FastestOpSec       float64 `json:"fastest_operation_sec"`
	SlowestOpSec       float64 `json:"slowest_operation_sec"`
	GPUAvailable       bool    `json:"gpu_available"`
}

// Collector samples CPU/RAM in the background and provides aggregated stats.
type Collector struct {
	mu       sync.Mutex
	buf      []SystemSnapshot
	maxBuf   int
	interval time.Duration
	gpuAvail bool
	done     chan struct{}
	once     sync.Once
}

// NewCollector creates a Collector that samples every interval and keeps the
// last bufSize snapshots (ring buffer).
func NewCollector(interval time.Duration, bufSize int) *Collector {
	c := &Collector{
		buf:      make([]SystemSnapshot, 0, bufSize),
		maxBuf:   bufSize,
		interval: interval,
		done:     make(chan struct{}),
	}
	c.gpuAvail = probeGPU()
	return c
}

func (c *Collector) Start() {
	go func() {
		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()
		for {
			select {
			case <-c.done:
				return
			case <-ticker.C:
				snap := c.buildSnapshot()
				c.mu.Lock()
				if len(c.buf) >= c.maxBuf {
					c.buf = c.buf[1:]
				}
				c.buf = append(c.buf, snap)
				c.mu.Unlock()
			}
		}
	}()
}

func (c *Collector) Stop() {
	c.once.Do(func() { close(c.done) })
}

func (c *Collector) GPUAvailable() bool { return c.gpuAvail }

// Current returns a fresh snapshot (does not use the buffer).
func (c *Collector) Current() SystemSnapshot { return c.buildSnapshot() }

// PeriodBetween aggregates buffer snapshots that fall within [start, end].
func (c *Collector) PeriodBetween(start, end time.Time) PeriodMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()

	pm := PeriodMetrics{GPUAvail: c.gpuAvail}
	var cpuSum, ramSum, gpuSum float64

	for _, s := range c.buf {
		if s.Timestamp.Before(start) || s.Timestamp.After(end) {
			continue
		}
		pm.Samples++
		cpuSum += s.CPUPercent
		ramSum += s.RAMUsedMB
		if s.CPUPercent > pm.PeakCPU {
			pm.PeakCPU = s.CPUPercent
		}
		if s.RAMUsedMB > pm.PeakRAM {
			pm.PeakRAM = s.RAMUsedMB
		}
		if s.GPU != nil {
			gpuSum += s.GPU.UtilPercent
			if s.GPU.UtilPercent > pm.PeakGPU {
				pm.PeakGPU = s.GPU.UtilPercent
			}
		}
	}

	if pm.Samples > 0 {
		pm.AvgCPU = cpuSum / float64(pm.Samples)
		pm.AvgRAM = ramSum / float64(pm.Samples)
		if c.gpuAvail {
			pm.AvgGPU = gpuSum / float64(pm.Samples)
		}
	}
	return pm
}

func (c *Collector) buildSnapshot() SystemSnapshot {
	snap := SystemSnapshot{
		Timestamp:    time.Now(),
		ProcMemoryMB: readProcessMemoryMB(),
		CPUPercent:   readCPUPercent(),
	}
	snap.RAMUsedMB, snap.RAMTotalMB = readSystemRAM()
	if snap.RAMTotalMB > 0 {
		snap.RAMPercent = snap.RAMUsedMB / snap.RAMTotalMB * 100
	}
	if c.gpuAvail {
		snap.GPU = readGPU()
	}
	return snap
}

// ─── CPU reading ──────────────────────────────────────────────────────────────

func readCPUPercent() float64 {
	switch runtime.GOOS {
	case "windows":
		return readCPUWindows()
	case "linux", "darwin":
		return readCPULinux()
	default:
		return -1
	}
}

func readCPUWindows() float64 {
	// wmic is faster than powershell for this query
	out, err := exec.Command("wmic", "cpu", "get", "loadpercentage", "/format:value").Output()
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "LoadPercentage=") {
			v, err := strconv.ParseFloat(strings.TrimPrefix(line, "LoadPercentage="), 64)
			if err == nil {
				return v
			}
		}
	}
	return -1
}

// linuxCPU tracks previous /proc/stat values for delta computation.
var linuxCPU struct {
	mu          sync.Mutex
	prevTotal   uint64
	prevIdle    uint64
}

func readCPULinux() float64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return -1
	}
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return -1
		}
		var vals []uint64
		for _, f := range fields[1:] {
			n, _ := strconv.ParseUint(f, 10, 64)
			vals = append(vals, n)
		}
		idle := vals[3]
		if len(vals) > 4 {
			idle += vals[4] // iowait
		}
		var total uint64
		for _, v := range vals {
			total += v
		}

		linuxCPU.mu.Lock()
		prevTotal, prevIdle := linuxCPU.prevTotal, linuxCPU.prevIdle
		linuxCPU.prevTotal, linuxCPU.prevIdle = total, idle
		linuxCPU.mu.Unlock()

		if prevTotal == 0 {
			return -1
		}
		dt := float64(total - prevTotal)
		di := float64(idle - prevIdle)
		if dt <= 0 {
			return 0
		}
		return (1 - di/dt) * 100
	}
	return -1
}

// ─── RAM reading ──────────────────────────────────────────────────────────────

func readSystemRAM() (usedMB, totalMB float64) {
	switch runtime.GOOS {
	case "windows":
		return readRAMWindows()
	case "linux", "darwin":
		return readRAMLinux()
	default:
		return -1, -1
	}
}

func readRAMWindows() (usedMB, totalMB float64) {
	out, err := exec.Command("wmic", "OS", "get",
		"FreePhysicalMemory,TotalVisibleMemorySize", "/format:value").Output()
	if err != nil {
		return -1, -1
	}
	var free, total uint64
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "FreePhysicalMemory=") {
			free, _ = strconv.ParseUint(strings.TrimPrefix(line, "FreePhysicalMemory="), 10, 64)
		}
		if strings.HasPrefix(line, "TotalVisibleMemorySize=") {
			total, _ = strconv.ParseUint(strings.TrimPrefix(line, "TotalVisibleMemorySize="), 10, 64)
		}
	}
	if total == 0 {
		return -1, -1
	}
	// wmic reports in KB
	return float64(total-free) / 1024, float64(total) / 1024
}

func readRAMLinux() (usedMB, totalMB float64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1, -1
	}
	var total, available uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			total = val
		case "MemAvailable:":
			available = val
		}
	}
	if total == 0 {
		return -1, -1
	}
	// /proc/meminfo reports in kB
	return float64(total-available) / 1024, float64(total) / 1024
}

func readProcessMemoryMB() float64 {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return float64(ms.Alloc) / (1024 * 1024)
}

// ─── GPU (nvidia-smi) ─────────────────────────────────────────────────────────

func probeGPU() bool {
	cmd := exec.Command("nvidia-smi", "--query-gpu=name", "--format=csv,noheader")
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run() == nil
}

func readGPU() *GPUInfo {
	out, err := exec.Command("nvidia-smi",
		"--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
		"--format=csv,noheader,nounits",
	).Output()
	if err != nil {
		return nil
	}
	line := strings.TrimSpace(string(out))
	// Take only the first GPU (first line)
	if idx := strings.Index(line, "\n"); idx >= 0 {
		line = line[:idx]
	}
	parts := strings.Split(line, ",")
	if len(parts) < 4 {
		return nil
	}
	for i, p := range parts {
		parts[i] = strings.TrimSpace(p)
	}
	info := &GPUInfo{Name: parts[0]}
	info.UtilPercent, _ = strconv.ParseFloat(parts[1], 64)
	info.UsedMB, _ = strconv.ParseFloat(parts[2], 64)
	info.TotalMB, _ = strconv.ParseFloat(parts[3], 64)
	if len(parts) >= 5 {
		info.TempC, _ = strconv.ParseFloat(parts[4], 64)
	}
	return info
}
