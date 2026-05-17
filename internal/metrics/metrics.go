package metrics

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GPUInfo struct {
	Name        string  `json:"name,omitempty"`
	UtilPercent float64 `json:"util_percent"`
	MemUsedMB   int64   `json:"mem_used_mb"`
	MemTotalMB  int64   `json:"mem_total_mb"`
	Source      string  `json:"source,omitempty"`
	Available   bool    `json:"available"`
}

type SystemSnapshot struct {
	ProcMemoryMB float64  `json:"proc_memory_mb"`
	CPUPercent   float64  `json:"cpu_percent"`
	RAMUsedMB    float64  `json:"ram_used_mb"`
	RAMTotalMB   float64  `json:"ram_total_mb"`
	RAMPercent   float64  `json:"ram_percent"`
	GPU          *GPUInfo `json:"gpu,omitempty"`
}

var (
	cacheMu sync.RWMutex
	cached  SystemSnapshot
	once    sync.Once

	// Separate mutex for CPU delta state so it doesn't block cache reads.
	cpuMu     sync.Mutex
	prevIdle  uint64
	prevTotal uint64
)

// Start begins background sampling every 2 seconds. Safe to call multiple times.
func Start() {
	once.Do(func() {
		if runtime.GOOS == "linux" {
			cpuMu.Lock()
			prevIdle, prevTotal, _ = readProcStat()
			cpuMu.Unlock()
			time.Sleep(300 * time.Millisecond)
		}

		s := sample()
		cacheMu.Lock()
		cached = s
		cacheMu.Unlock()

		go func() {
			for {
				time.Sleep(2 * time.Second)
				s := sample()
				cacheMu.Lock()
				cached = s
				cacheMu.Unlock()
			}
		}()
	})
}

// Current returns the most recent cached snapshot.
func Current() SystemSnapshot {
	cacheMu.RLock()
	defer cacheMu.RUnlock()
	return cached
}

func sample() SystemSnapshot {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	snap := SystemSnapshot{
		ProcMemoryMB: float64(ms.Sys) / (1024 * 1024),
		CPUPercent:   -1,
		RAMUsedMB:    -1,
		RAMTotalMB:   -1,
		RAMPercent:   -1,
	}

	if cpu := getCPUPercent(); cpu >= 0 {
		snap.CPUPercent = cpu
	}

	used, total := getSystemRAM()
	if total > 0 {
		snap.RAMUsedMB = used
		snap.RAMTotalMB = total
		snap.RAMPercent = (used / total) * 100
	}

	if gpu := getGPUInfo(); gpu != nil {
		snap.GPU = gpu
	} else {
		snap.GPU = &GPUInfo{
			Name:      "GPU not detected",
			Source:    "none",
			Available: false,
			UtilPercent: -1,
			MemUsedMB:  -1,
			MemTotalMB: -1,
		}
	}

	return snap
}

// ─── CPU ─────────────────────────────────────────────────────────────────────

func getCPUPercent() float64 {
	if runtime.GOOS == "linux" {
		return getCPUPercentLinux()
	}
	return getCPUPercentWindows()
}

func readProcStat() (idle, total uint64, err error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			break
		}
		var vals [10]uint64
		for i, f := range fields[1:] {
			if i >= 10 {
				break
			}
			vals[i], _ = strconv.ParseUint(f, 10, 64)
		}
		// indices: 0=user 1=nice 2=system 3=idle 4=iowait 5=irq 6=softirq 7=steal
		idleTicks := vals[3] + vals[4] // idle + iowait
		var tot uint64
		for _, v := range vals {
			tot += v
		}
		return idleTicks, tot, nil
	}
	return 0, 0, nil
}

func getCPUPercentLinux() float64 {
	idle2, total2, err := readProcStat()
	if err != nil || total2 == 0 {
		return -1
	}

	cpuMu.Lock()
	pi, pt := prevIdle, prevTotal
	prevIdle, prevTotal = idle2, total2
	cpuMu.Unlock()

	dTotal := float64(total2 - pt)
	dIdle := float64(idle2 - pi)
	if dTotal <= 0 {
		return 0
	}
	return (1 - dIdle/dTotal) * 100
}

func getCPUPercentWindows() float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "wmic", "cpu", "get", "loadpercentage", "/value").Output()
	if err != nil {
		return -1
	}
	for _, raw := range strings.Split(string(out), "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if v, ok := strings.CutPrefix(line, "LoadPercentage="); ok {
			if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				return f
			}
		}
	}
	return -1
}

// ─── System RAM ───────────────────────────────────────────────────────────────

// getSystemRAM returns (usedMB, totalMB) from /proc/meminfo, or (-1,-1) on error.
func getSystemRAM() (usedMB, totalMB float64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1, -1
	}
	var memTotal, memFree, buffers, cached, sReclaimable uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			memTotal = val
		case "MemFree:":
			memFree = val
		case "Buffers:":
			buffers = val
		case "Cached:":
			cached = val
		case "SReclaimable:":
			sReclaimable = val
		}
	}
	if memTotal == 0 {
		return -1, -1
	}
	available := memFree + buffers + cached + sReclaimable
	usedKB := memTotal - available
	return float64(usedKB) / 1024, float64(memTotal) / 1024
}

// ─── GPU ─────────────────────────────────────────────────────────────────────

func getGPUInfo() *GPUInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "nvidia-smi",
		"--query-gpu=name,utilization.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits",
	).Output()
	if err != nil {
		if runtime.GOOS == "windows" {
			return getGPUInfoWindows()
		}
		return nil
	}

	line := strings.TrimSpace(string(out))
	if idx := strings.Index(line, "\n"); idx >= 0 {
		line = line[:idx]
	}
	// Format: "NVIDIA GeForce RTX 3080, 45, 2048, 10240"
	// Name may contain commas — split from right so we get the last 3 numeric fields.
	parts := strings.Split(line, ", ")
	if len(parts) < 4 {
		// Try plain comma split.
		parts = strings.SplitN(line, ",", 4)
	}
	if len(parts) < 4 {
		return nil
	}

	name := strings.TrimSpace(parts[0])
	util, err1 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	memUsed, err2 := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	memTotal, err3 := strconv.ParseInt(strings.TrimSpace(parts[3]), 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return nil
	}

	return &GPUInfo{
		Name:        name,
		UtilPercent: util,
		MemUsedMB:   memUsed,
		MemTotalMB:  memTotal,
		Source:      "nvidia-smi",
		Available:   true,
	}
}

func getGPUInfoWindows() *GPUInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "wmic", "path", "win32_videocontroller", "get", "Name,AdapterRAM", "/format:list").Output()
	if err != nil {
		return nil
	}

	blocks := strings.Split(string(out), "\n\n")
	for _, block := range blocks {
		name := ""
		var adapterRAM uint64
		for _, raw := range strings.Split(block, "\n") {
			line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
			if line == "" {
				continue
			}
			if v, ok := strings.CutPrefix(line, "Name="); ok {
				name = strings.TrimSpace(v)
				continue
			}
			if v, ok := strings.CutPrefix(line, "AdapterRAM="); ok {
				if parsed, parseErr := strconv.ParseUint(strings.TrimSpace(v), 10, 64); parseErr == nil {
					adapterRAM = parsed
				}
			}
		}

		if name == "" && adapterRAM == 0 {
			continue
		}

		totalMB := int64(0)
		if adapterRAM > 0 {
			totalMB = int64(adapterRAM / (1024 * 1024))
		}

		return &GPUInfo{
			Name:        name,
			UtilPercent: -1,
			MemUsedMB:   -1,
			MemTotalMB:  totalMB,
			Source:      "wmic",
			Available:   true,
		}
	}

	return nil
}
