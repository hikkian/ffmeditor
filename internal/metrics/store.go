package metrics

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Store writes metric records to disk (JSONL + CSV) and keeps an in-memory
// cache for fast API reads.
type Store struct {
	mu          sync.RWMutex
	dir         string
	operations  []OperationRecord // in-memory cache (last 1000)
	maxCache    int
	sysFile     *os.File
	opsFile     *os.File
	csvFile     *os.File
	csvWriter   *csv.Writer
	csvHeader   bool
}

// NewStore opens (or creates) the metrics directory and log files.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("metrics: create dir %s: %w", dir, err)
	}

	sysFile, err := os.OpenFile(filepath.Join(dir, "system_metrics.jsonl"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("metrics: open system_metrics.jsonl: %w", err)
	}

	opsFile, err := os.OpenFile(filepath.Join(dir, "ffmpeg_operations.jsonl"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		sysFile.Close()
		return nil, fmt.Errorf("metrics: open ffmpeg_operations.jsonl: %w", err)
	}

	csvPath := filepath.Join(dir, "benchmark_summary.csv")
	csvExists := fileExists(csvPath)
	csvFile, err := os.OpenFile(csvPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		sysFile.Close()
		opsFile.Close()
		return nil, fmt.Errorf("metrics: open benchmark_summary.csv: %w", err)
	}

	s := &Store{
		dir:       dir,
		maxCache:  1000,
		sysFile:   sysFile,
		opsFile:   opsFile,
		csvFile:   csvFile,
		csvWriter: csv.NewWriter(csvFile),
		csvHeader: !csvExists,
	}
	if s.csvHeader {
		_ = s.writeCSVHeader()
	}
	return s, nil
}

// Close flushes and closes all open files.
func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.csvWriter.Flush()
	_ = s.sysFile.Close()
	_ = s.opsFile.Close()
	_ = s.csvFile.Close()
}

// WriteSystemSnapshot appends a snapshot to system_metrics.jsonl.
func (s *Store) WriteSystemSnapshot(snap SystemSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.Marshal(snap)
	if err != nil {
		return
	}
	_, _ = s.sysFile.Write(append(data, '\n'))
}

// WriteOperation appends an operation record to both JSONL and CSV,
// and caches it in memory.
func (s *Store) WriteOperation(rec OperationRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// JSONL
	data, err := json.Marshal(rec)
	if err == nil {
		_, _ = s.opsFile.Write(append(data, '\n'))
	}

	// CSV
	_ = s.writeCSVRow(rec)
	s.csvWriter.Flush()

	// In-memory cache
	s.operations = append(s.operations, rec)
	if len(s.operations) > s.maxCache {
		s.operations = s.operations[1:]
	}
}

// GetLastOperations returns the most recent n operation records.
func (s *Store) GetLastOperations(n int) []OperationRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n <= 0 || len(s.operations) == 0 {
		return nil
	}
	if n > len(s.operations) {
		n = len(s.operations)
	}
	result := make([]OperationRecord, n)
	copy(result, s.operations[len(s.operations)-n:])
	return result
}

// GetSummary computes aggregate statistics over all cached operations.
func (s *Store) GetSummary() Summary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sum := Summary{}
	if len(s.operations) == 0 {
		return sum
	}

	sum.TotalOperations = len(s.operations)
	sum.FastestOpSec = 1e9
	var cpuSum, speedSum, comprSum float64
	var timeSum float64

	for _, r := range s.operations {
		if r.Success {
			sum.SuccessCount++
		} else {
			sum.FailureCount++
		}
		timeSum += r.ProcessingTimeSec
		cpuSum += r.AvgCPUPercent
		speedSum += r.SpeedRatio
		if r.InputSizeMB > 0 {
			comprSum += r.OutputSizeMB / r.InputSizeMB * 100
		}
		if r.PeakRAMMB > sum.PeakRAMMB {
			sum.PeakRAMMB = r.PeakRAMMB
		}
		if r.ProcessingTimeSec < sum.FastestOpSec && r.ProcessingTimeSec > 0 {
			sum.FastestOpSec = r.ProcessingTimeSec
		}
		if r.ProcessingTimeSec > sum.SlowestOpSec {
			sum.SlowestOpSec = r.ProcessingTimeSec
		}
		if r.GPUAvailable {
			sum.GPUAvailable = true
		}
	}

	n := float64(sum.TotalOperations)
	sum.AvgProcessingTime = timeSum / n
	sum.AvgCPUPercent = cpuSum / n
	sum.AvgSpeedRatio = speedSum / n
	sum.AvgCompressionPct = comprSum / n
	if sum.TotalOperations > 0 {
		sum.SuccessRate = float64(sum.SuccessCount) / n * 100
	}
	if sum.FastestOpSec == 1e9 {
		sum.FastestOpSec = 0
	}
	return sum
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

var csvColumns = []string{
	"timestamp", "operation_id", "job_id", "operation",
	"input_file", "input_size_mb", "input_duration_sec",
	"output_size_mb", "processing_time_sec", "speed_ratio",
	"avg_cpu_percent", "peak_cpu_percent", "avg_ram_mb", "peak_ram_mb",
	"gpu_available", "avg_gpu_percent",
	"ffmpeg_speed", "ffmpeg_fps", "ffmpeg_bitrate_kbps",
	"output_format", "video_codec", "audio_codec",
	"success", "error",
}

func (s *Store) writeCSVHeader() error {
	return s.csvWriter.Write(csvColumns)
}

func (s *Store) writeCSVRow(r OperationRecord) error {
	row := []string{
		r.Timestamp.Format(time.RFC3339),
		r.ID,
		r.JobID,
		r.Operation,
		r.InputFile,
		fmtF(r.InputSizeMB),
		fmtF(r.InputDurationSec),
		fmtF(r.OutputSizeMB),
		fmtF(r.ProcessingTimeSec),
		fmtF(r.SpeedRatio),
		fmtF(r.AvgCPUPercent),
		fmtF(r.PeakCPUPercent),
		fmtF(r.AvgRAMMB),
		fmtF(r.PeakRAMMB),
		boolStr(r.GPUAvailable),
		fmtF(r.AvgGPUPercent),
		fmtF(r.FFmpegSpeed),
		fmtF(r.FFmpegFPS),
		fmtF(r.FFmpegBitrateKbps),
		r.OutputFormat,
		r.VideoCodec,
		r.AudioCodec,
		boolStr(r.Success),
		r.ErrorMessage,
	}
	return s.csvWriter.Write(row)
}

func fmtF(v float64) string  { return fmt.Sprintf("%.4f", v) }
func boolStr(v bool) string  { if v { return "true" }; return "false" }
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
