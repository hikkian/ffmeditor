package metrics

import (
	"encoding/json"
	"math"
	"os"
	"sync"
	"time"
)

// OperationRecord holds metrics for one completed export/merge/convert.
type OperationRecord struct {
	OperationID       string    `json:"operation_id"`
	Operation         string    `json:"operation"`
	ProcessingTimeSec float64   `json:"processing_time_sec"`
	InputSizeMB       float64   `json:"input_size_mb"`
	OutputSizeMB      float64   `json:"output_size_mb"`
	SpeedRatio        float64   `json:"speed_ratio"`
	FFmpegSpeed       float64   `json:"ffmpeg_speed"`
	FFmpegFPS         float64   `json:"ffmpeg_fps"`
	AvgCPUPercent     float64   `json:"avg_cpu_percent"`
	PeakRAMMB         float64   `json:"peak_ram_mb"`
	OutputFormat      string    `json:"output_format"`
	Strategy          string    `json:"strategy"`
	Success           bool      `json:"success"`
	Error             string    `json:"error,omitempty"`
	GPUUsed           bool      `json:"gpu_used"`
	RecordedAt        time.Time `json:"recorded_at"`
}

// OperationsSummary aggregates all recorded operations.
type OperationsSummary struct {
	TotalOperations      int     `json:"total_operations"`
	SuccessCount         int     `json:"success_count"`
	FailureCount         int     `json:"failure_count"`
	SuccessRatePercent   float64 `json:"success_rate_percent"`
	AvgProcessingTimeSec float64 `json:"avg_processing_time_sec"`
	AvgSpeedRatio        float64 `json:"avg_speed_ratio"`
	FastestOperationSec  float64 `json:"fastest_operation_sec"`
	SlowestOperationSec  float64 `json:"slowest_operation_sec"`
	AvgCPUPercent        float64 `json:"avg_cpu_percent"`
	PeakRAMMB            float64 `json:"peak_ram_mb"`
	AvgCompressionPct    float64 `json:"avg_compression_pct"`
	GPUAvailable         bool    `json:"gpu_available"`
}

// OperationStore persists operation records to a JSON file.
type OperationStore struct {
	mu       sync.RWMutex
	records  []OperationRecord
	filePath string
}

// NewOperationStore loads existing records from filePath and returns the store.
func NewOperationStore(filePath string) *OperationStore {
	s := &OperationStore{filePath: filePath}
	s.load()
	return s
}

// Record appends rec and saves to disk.
func (s *OperationStore) Record(rec OperationRecord) {
	if rec.RecordedAt.IsZero() {
		rec.RecordedAt = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = append(s.records, rec)
	s.save()
}

// All returns a copy of all records.
func (s *OperationStore) All() []OperationRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]OperationRecord, len(s.records))
	copy(out, s.records)
	return out
}

// Summary aggregates all records into a summary.
func (s *OperationStore) Summary() OperationsSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sum := OperationsSummary{FastestOperationSec: math.MaxFloat64}
	var totalTime, totalSpeed, totalCPU, totalCompression float64
	var speedN, cpuN, compressionN int

	for _, r := range s.records {
		sum.TotalOperations++
		if r.Success {
			sum.SuccessCount++
		} else {
			sum.FailureCount++
		}
		if r.ProcessingTimeSec > 0 {
			totalTime += r.ProcessingTimeSec
			if r.ProcessingTimeSec < sum.FastestOperationSec {
				sum.FastestOperationSec = r.ProcessingTimeSec
			}
			if r.ProcessingTimeSec > sum.SlowestOperationSec {
				sum.SlowestOperationSec = r.ProcessingTimeSec
			}
		}
		if r.SpeedRatio > 0 {
			totalSpeed += r.SpeedRatio
			speedN++
		}
		if r.AvgCPUPercent >= 0 {
			totalCPU += r.AvgCPUPercent
			cpuN++
		}
		if r.PeakRAMMB > sum.PeakRAMMB {
			sum.PeakRAMMB = r.PeakRAMMB
		}
		if r.InputSizeMB > 0 && r.OutputSizeMB > 0 {
			totalCompression += (1 - r.OutputSizeMB/r.InputSizeMB) * 100
			compressionN++
		}
		if r.GPUUsed {
			sum.GPUAvailable = true
		}
	}

	if sum.TotalOperations > 0 {
		sum.AvgProcessingTimeSec = totalTime / float64(sum.TotalOperations)
		sum.SuccessRatePercent = float64(sum.SuccessCount) / float64(sum.TotalOperations) * 100
	}
	if speedN > 0 {
		sum.AvgSpeedRatio = totalSpeed / float64(speedN)
	}
	if cpuN > 0 {
		sum.AvgCPUPercent = totalCPU / float64(cpuN)
	}
	if compressionN > 0 {
		sum.AvgCompressionPct = totalCompression / float64(compressionN)
	}
	if sum.FastestOperationSec == math.MaxFloat64 {
		sum.FastestOperationSec = 0
	}
	return sum
}

func (s *OperationStore) load() {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &s.records)
}

func (s *OperationStore) save() {
	data, err := json.Marshal(s.records)
	if err != nil {
		return
	}
	_ = os.WriteFile(s.filePath, data, 0644)
}

// ─── Per-operation sampler ────────────────────────────────────────────────────

// Sampler collects CPU% and RAM during a job and reports averages on Stop.
type Sampler struct {
	mu      sync.Mutex
	cpuSum  float64
	cpuN    int
	peakRAM float64
	done    chan struct{}
}

// NewSampler starts background sampling immediately.
func NewSampler() *Sampler {
	s := &Sampler{done: make(chan struct{})}
	go s.run()
	return s
}

func (s *Sampler) run() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			snap := Current()
			s.mu.Lock()
			if snap.CPUPercent >= 0 {
				s.cpuSum += snap.CPUPercent
				s.cpuN++
			}
			if snap.ProcMemoryMB > s.peakRAM {
				s.peakRAM = snap.ProcMemoryMB
			}
			s.mu.Unlock()
		}
	}
}

// Stop ends sampling and returns (avgCPU, peakRAMMB). avgCPU is -1 if no samples.
func (s *Sampler) Stop() (avgCPU, peakRAMMB float64) {
	close(s.done)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cpuN > 0 {
		avgCPU = s.cpuSum / float64(s.cpuN)
	} else {
		avgCPU = -1
	}
	peakRAMMB = s.peakRAM
	return
}
