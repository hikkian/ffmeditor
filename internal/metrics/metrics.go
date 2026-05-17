package metrics

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"syscall"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"unsafe"
	"time"
)

type GPUInfo struct {
	Name        string  `json:"name,omitempty"`
	UtilPercent float64 `json:"util_percent"`
	MemUsedMB    int64   `json:"mem_used_mb"`
	MemTotalMB   int64   `json:"mem_total_mb"`
	Source       string  `json:"source,omitempty"`
}

type SystemSnapshot struct {
	ProcMemoryMB float64  `json:"proc_memory_mb"`
	CPUPercent   float64  `json:"cpu_percent"`
	RamUsedMB    float64  `json:"ram_used_mb"`
	RamTotalMB   float64  `json:"ram_total_mb"`
	RamPercent   float64  `json:"ram_percent"`
	GPU          *GPUInfo `json:"gpu,omitempty"`
}

var (
	mu   sync.RWMutex
	cached SystemSnapshot
	once sync.Once

	// Linux /proc/stat state for delta-based CPU calculation.
	prevIdle  uint64
	prevTotal uint64

	// Windows GetSystemTimes state.
	prevWinIdle   uint64
	prevWinKernel uint64
	prevWinUser   uint64
)

// Start begins background sampling every 2 seconds. Safe to call multiple times.
func Start() {
	once.Do(func() {
		switch runtime.GOOS {
		case "linux":
			prevIdle, prevTotal, _ = readProcStat()
		case "windows":
			prevWinIdle, prevWinKernel, prevWinUser, _ = readSystemTimesWindows()
			time.Sleep(200 * time.Millisecond)
		}

		snap := sample()
		mu.Lock()
		cached = snap
		mu.Unlock()

		go func() {
			for {
				time.Sleep(2 * time.Second)
				snap := sample()
				mu.Lock()
				cached = snap
				mu.Unlock()
			}
		}()
	})
}

// Current returns the most recent cached snapshot.
func Current() SystemSnapshot {
	mu.RLock()
	defer mu.RUnlock()
	return cached
}

func sample() SystemSnapshot {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	snap := SystemSnapshot{
		ProcMemoryMB: float64(ms.Sys) / (1024 * 1024),
		CPUPercent:   -1,
		RamUsedMB:    -1,
		RamTotalMB:   -1,
		RamPercent:   -1,
	}

	if cpu := getCPUPercent(); cpu >= 0 {
		snap.CPUPercent = cpu
	}
	if used, total, pct := getSystemMemory(); total > 0 && used >= 0 {
		snap.RamUsedMB = used
		snap.RamTotalMB = total
		snap.RamPercent = pct
	}
	if gpu := getGPUInfo(); gpu != nil {
		snap.GPU = gpu
	}

	return snap
}

// getCPUPercent returns system-wide CPU usage (0-100).
// On Linux reads /proc/stat; on Windows tries PowerShell, then typeperf, then wmic.
func getCPUPercent() float64 {
	if runtime.GOOS == "linux" {
		return getCPUPercentLinux()
	}
	return getCPUPercentWindows()
}

// readProcStat returns (idle, total) tick counts from /proc/stat.
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
		// fields: cpu user nice system idle iowait irq softirq steal ...
		if len(fields) < 5 {
			break
		}
		vals := make([]uint64, 0, 8)
		for _, f := range fields[1:] {
			v, _ := strconv.ParseUint(f, 10, 64)
			vals = append(vals, v)
		}
		if len(vals) >= 4 {
			// idle = idle + iowait
			idleTicks := vals[3]
			if len(vals) >= 5 {
				idleTicks += vals[4]
			}
			var tot uint64
			for _, v := range vals {
				tot += v
			}
			return idleTicks, tot, nil
		}
		break
	}
	return 0, 0, nil
}

func getCPUPercentLinux() float64 {
	idle2, total2, err := readProcStat()
	if err != nil || total2 == 0 {
		return -1
	}

	mu.Lock()
	pi, pt := prevIdle, prevTotal
	prevIdle, prevTotal = idle2, total2
	mu.Unlock()

	dTotal := float64(total2 - pt)
	dIdle := float64(idle2 - pi)
	if dTotal <= 0 {
		return 0
	}
	return (1 - dIdle/dTotal) * 100
}

func getCPUPercentWindows() float64 {
	if cpu := getCPUPercentWindowsNative(); cpu >= 0 {
		return cpu
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command",
		"(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue",
	).Output(); err == nil {
		if f, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64); err == nil {
			return f
		}
	}

	out, err := exec.CommandContext(ctx, "typeperf", `\Processor(_Total)\% Processor Time`, "-sc", "1").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if line == "" || strings.HasPrefix(line, "\"(") {
				continue
			}
			parts := strings.Split(line, ",")
			if len(parts) == 0 {
				continue
			}
			last := strings.TrimSpace(strings.Trim(parts[len(parts)-1], "\""))
			if f, parseErr := strconv.ParseFloat(last, 64); parseErr == nil {
				return f
			}
		}
	}

	out, err = exec.CommandContext(ctx, "wmic", "cpu", "get", "loadpercentage", "/value").Output()
	if err != nil {
		return -1
	}
	for _, raw := range strings.Split(string(out), "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if strings.HasPrefix(line, "LoadPercentage=") {
			v := strings.TrimPrefix(line, "LoadPercentage=")
			if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				return f
			}
		}
	}
	return -1
}

func getCPUPercentWindowsNative() float64 {
	idle2, kernel2, user2, err := readSystemTimesWindows()
	if err != nil {
		return -1
	}

	mu.Lock()
	pi, pk, pu := prevWinIdle, prevWinKernel, prevWinUser
	prevWinIdle, prevWinKernel, prevWinUser = idle2, kernel2, user2
	mu.Unlock()

	if pk == 0 && pu == 0 {
		return -1
	}

	dIdle := float64(idle2 - pi)
	dKernel := float64(kernel2 - pk)
	dUser := float64(user2 - pu)
	dTotal := dKernel + dUser
	if dTotal <= 0 {
		return 0
	}

	usage := (1 - dIdle/dTotal) * 100
	if usage < 0 {
		return 0
	}
	if usage > 100 {
		return 100
	}
	return usage
}

func getSystemMemory() (usedMB, totalMB, percent float64) {
	switch runtime.GOOS {
	case "linux":
		return getSystemMemoryLinux()
	case "windows":
		return getSystemMemoryWindows()
	default:
		return -1, -1, -1
	}
}

func getSystemMemoryLinux() (usedMB, totalMB, percent float64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1, -1, -1
	}

	var memTotalKB, memAvailableKB float64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseFloat(fields[1], 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			memTotalKB = value
		case "MemAvailable:":
			memAvailableKB = value
		}
	}

	if memTotalKB <= 0 {
		return -1, -1, -1
	}
	usedKB := memTotalKB - memAvailableKB
	if usedKB < 0 {
		usedKB = 0
	}
	totalMB = memTotalKB / 1024
	usedMB = usedKB / 1024
	percent = (usedKB / memTotalKB) * 100
	return usedMB, totalMB, percent
}

func getSystemMemoryWindows() (usedMB, totalMB, percent float64) {
	status, err := readMemoryStatusEx()
	if err != nil {
		return -1, -1, -1
	}

	if status.totalPhys == 0 {
		return -1, -1, -1
	}

	totalMB = float64(status.totalPhys) / (1024 * 1024)
	usedMB = float64(status.totalPhys-status.availPhys) / (1024 * 1024)
	percent = usedMB / totalMB * 100
	return usedMB, totalMB, percent
}

// getGPUInfo queries nvidia-smi for utilisation and VRAM.
func getGPUInfo() *GPUInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "nvidia-smi",
		"--query-gpu=utilization.gpu,memory.used,memory.total",
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
	parts := strings.Split(line, ",")
	if len(parts) < 3 {
		return nil
	}

	util, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	memUsed, err2 := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	memTotal, err3 := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return nil
	}

	return &GPUInfo{
		Name:        "NVIDIA GPU",
		UtilPercent: util,
		MemUsedMB:   memUsed,
		MemTotalMB:  memTotal,
		Source:      "nvidia-smi",
	}
}

func getGPUInfoWindows() *GPUInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	type windowsGPU struct {
		Name       string `json:"Name"`
		AdapterRAM int64  `json:"AdapterRAM"`
	}

	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command",
		"Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress",
	).Output()
	if err != nil {
		return nil
	}

	var gpu windowsGPU
	if err := json.Unmarshal(bytesTrimSpace(out), &gpu); err != nil {
		return nil
	}

	if gpu.Name == "" && gpu.AdapterRAM <= 0 {
		return nil
	}

	totalMB := int64(0)
	if gpu.AdapterRAM > 0 {
		totalMB = gpu.AdapterRAM / (1024 * 1024)
	}

	return &GPUInfo{
		Name:        gpu.Name,
		UtilPercent: -1,
		MemUsedMB:   -1,
		MemTotalMB:  totalMB,
		Source:      "win32_videocontroller",
	}
}

func bytesTrimSpace(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

type memoryStatus struct {
	dwLength     uint32
	dwMemoryLoad uint32
	totalPhys    uint64
	availPhys    uint64
	totalPageFile uint64
	availPageFile uint64
	totalVirtual uint64
	availVirtual uint64
	availExtVirtual uint64
}

func readMemoryStatusEx() (*memoryStatus, error) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GlobalMemoryStatusEx")

	status := &memoryStatus{}
	status.dwLength = uint32(unsafe.Sizeof(*status))

	r1, _, err := proc.Call(uintptr(unsafe.Pointer(status)))
	if r1 == 0 {
		if err != syscall.Errno(0) {
			return nil, err
		}
		return nil, syscall.EINVAL
	}

	return status, nil
}

func readSystemTimesWindows() (idle, kernel, user uint64, err error) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetSystemTimes")

	var idleFT, kernelFT, userFT syscall.Filetime
	r1, _, callErr := proc.Call(
		uintptr(unsafe.Pointer(&idleFT)),
		uintptr(unsafe.Pointer(&kernelFT)),
		uintptr(unsafe.Pointer(&userFT)),
	)
	if r1 == 0 {
		if callErr != syscall.Errno(0) {
			err = callErr
		} else {
			err = syscall.EINVAL
		}
		return 0, 0, 0, err
	}

	return filetimeToUint64(idleFT), filetimeToUint64(kernelFT), filetimeToUint64(userFT), nil
}

func filetimeToUint64(ft syscall.Filetime) uint64 {
	return uint64(ft.LowDateTime) | (uint64(ft.HighDateTime) << 32)
}
