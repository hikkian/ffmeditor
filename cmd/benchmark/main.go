// Benchmark tool: runs a standard set of FFmpeg operations against a running
// server and records the results in benchmark_results/.
//
// Usage:
//   go run ./cmd/benchmark -file path/to/video.mp4
//   go run ./cmd/benchmark -file path/to/video.mp4 -server http://localhost:8080
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type uploadResp struct {
	FileID       string          `json:"file_id"`
	OriginalName string          `json:"original_name"`
	MediaInfo    json.RawMessage `json:"media_info"`
}

type jobResp struct {
	JobID    string  `json:"job_id"`
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Error    string  `json:"error"`
}

type benchResult struct {
	BenchmarkID       string    `json:"benchmark_id"`
	Timestamp         time.Time `json:"timestamp"`
	Operation         string    `json:"operation"`
	InputFile         string    `json:"input_file"`
	InputSizeMB       float64   `json:"input_size_mb"`
	OutputFormat      string    `json:"output_format"`
	VideoCodec        string    `json:"video_codec,omitempty"`
	ProcessingTimeSec float64   `json:"processing_time_sec"`
	OutputSizeMB      float64   `json:"output_size_mb,omitempty"`
	SpeedRatio        float64   `json:"speed_ratio,omitempty"`
	Success           bool      `json:"success"`
	ErrorMsg          string    `json:"error,omitempty"`
	ServerMetrics     *sysSnap  `json:"server_metrics_at_end,omitempty"`
}

type sysSnap struct {
	CPUPercent float64 `json:"cpu_percent"`
	RAMUsedMB  float64 `json:"ram_used_mb"`
	RAMPercent float64 `json:"ram_percent"`
}

type opDef struct {
	name   string
	format string
	codec  string
	body   map[string]interface{}
}

func main() {
	filePath := flag.String("file", "", "Path to test video file (required)")
	server := flag.String("server", "http://localhost:8080", "Backend server URL")
	outDir := flag.String("out", "benchmark_results", "Output directory for results")
	flag.Parse()

	if *filePath == "" {
		log.Fatal("Usage: go run ./cmd/benchmark -file <video_file> [-server <url>] [-out <dir>]")
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("Cannot create output dir: %v", err)
	}

	benchID := time.Now().Format("2006-01-02_15-04-05")
	log.Printf("=== FFM Editor Benchmark %s ===", benchID)
	log.Printf("Input file: %s", *filePath)
	log.Printf("Server: %s", *server)

	// --- 1. Upload file ---
	log.Println("\n[1/7] Uploading file...")
	fileID, inputSizeMB, err := uploadFile(*server, *filePath)
	if err != nil {
		log.Fatalf("Upload failed: %v", err)
	}
	log.Printf("  file_id=%s  size=%.2f MB", fileID, inputSizeMB)

	ops := []opDef{
		{
			name:   "convert_mp4_copy",
			format: "mp4",
			codec:  "copy",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "mp4",
				"video_codec":   "copy",
				"audio_codec":   "copy",
				"fast_start":    true,
			},
		},
		{
			name:   "convert_mp4_h264_fast",
			format: "mp4",
			codec:  "libx264",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "mp4",
				"video_codec":   "libx264",
				"audio_codec":   "aac",
				"preset":        "veryfast",
				"crf":           28,
				"fast_start":    true,
			},
		},
		{
			name:   "convert_mp4_h264_medium",
			format: "mp4",
			codec:  "libx264",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "mp4",
				"video_codec":   "libx264",
				"audio_codec":   "aac",
				"preset":        "medium",
				"crf":           23,
				"fast_start":    true,
			},
		},
		{
			name:   "convert_webm_vp9",
			format: "webm",
			codec:  "libvpx-vp9",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "webm",
				"video_codec":   "libvpx-vp9",
				"audio_codec":   "libopus",
				"crf":           30,
			},
		},
		{
			name:   "extract_audio_mp3",
			format: "mp3",
			codec:  "libmp3lame",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "mp3",
				"remove_video":  true,
				"audio_codec":   "libmp3lame",
				"audio_bitrate": "192k",
			},
		},
		{
			name:   "trim_10s_copy",
			format: "mp4",
			codec:  "copy",
			body: map[string]interface{}{
				"file_id":       fileID,
				"output_format": "mp4",
				"video_codec":   "copy",
				"audio_codec":   "copy",
				"trim_start":    0,
				"trim_duration": 10,
				"fast_start":    true,
			},
		},
	}

	var results []benchResult
	opIdx := 2

	for _, op := range ops {
		opIdx++
		log.Printf("\n[%d/%d] Operation: %s", opIdx, len(ops)+2, op.name)

		sysBefore := fetchSystemMetrics(*server)
		start := time.Now()

		jobID, runErr := runConvert(*server, op.body)
		var elapsed float64
		var outSizeMB float64

		if runErr != nil {
			elapsed = time.Since(start).Seconds()
			log.Printf("  FAILED to start job: %v", runErr)
			results = append(results, benchResult{
				BenchmarkID:       benchID,
				Timestamp:         start,
				Operation:         op.name,
				InputFile:         filepath.Base(*filePath),
				InputSizeMB:       inputSizeMB,
				OutputFormat:      op.format,
				VideoCodec:        op.codec,
				ProcessingTimeSec: elapsed,
				Success:           false,
				ErrorMsg:          runErr.Error(),
				ServerMetrics:     sysBefore,
			})
			continue
		}

		log.Printf("  job_id=%s", jobID)
		jobErr := pollJob(*server, jobID, func(pct float64) {
			fmt.Printf("\r  progress: %.0f%%   ", pct*100)
		})
		fmt.Println()
		elapsed = time.Since(start).Seconds()
		sysAfter := fetchSystemMetrics(*server)

		_ = sysAfter // we keep sysAfter for potential use below
		var speedRatio float64

		if jobErr == nil {
			// Try to get output size via server summary
			outSizeMB = 0
			log.Printf("  DONE in %.2fs", elapsed)
		} else {
			log.Printf("  FAILED: %v", jobErr)
		}

		r := benchResult{
			BenchmarkID:       benchID,
			Timestamp:         start,
			Operation:         op.name,
			InputFile:         filepath.Base(*filePath),
			InputSizeMB:       inputSizeMB,
			OutputFormat:      op.format,
			VideoCodec:        op.codec,
			ProcessingTimeSec: elapsed,
			OutputSizeMB:      outSizeMB,
			SpeedRatio:        speedRatio,
			Success:           jobErr == nil,
			ServerMetrics:     sysAfter,
		}
		if jobErr != nil {
			r.ErrorMsg = jobErr.Error()
		}
		results = append(results, r)
	}

	// --- Write results ---
	summaryPath := filepath.Join(*outDir, fmt.Sprintf("benchmark_%s.json", benchID))
	writeJSON(summaryPath, results)

	// Fetch server-side summary for enrichment
	serverSummary := fetchServerSummary(*server)
	if serverSummary != nil {
		ssPath := filepath.Join(*outDir, fmt.Sprintf("server_summary_%s.json", benchID))
		writeJSON(ssPath, serverSummary)
	}

	// Print summary table
	fmt.Println("\n=== RESULTS ===")
	fmt.Printf("%-32s %-8s %-10s %-10s %-6s\n", "Operation", "Format", "Time(s)", "In(MB)", "OK")
	fmt.Println(strings.Repeat("-", 72))
	for _, r := range results {
		ok := "✓"
		if !r.Success {
			ok = "✗"
		}
		fmt.Printf("%-32s %-8s %-10.2f %-10.2f %-6s\n",
			r.Operation, r.OutputFormat, r.ProcessingTimeSec, r.InputSizeMB, ok)
	}
	fmt.Printf("\nResults saved to: %s\n", summaryPath)
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func uploadFile(server, filePath string) (fileID string, sizeMB float64, err error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	info, _ := f.Stat()
	sizeMB = float64(info.Size()) / (1024 * 1024)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return "", 0, err
	}
	if _, err = io.Copy(fw, f); err != nil {
		return "", 0, err
	}
	w.Close()

	resp, err := http.Post(server+"/api/v1/upload", w.FormDataContentType(), &buf)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	var ur uploadResp
	if err = json.NewDecoder(resp.Body).Decode(&ur); err != nil {
		return "", 0, err
	}
	if ur.FileID == "" {
		return "", 0, fmt.Errorf("upload returned empty file_id")
	}
	return ur.FileID, sizeMB, nil
}

func runConvert(server string, body map[string]interface{}) (jobID string, err error) {
	data, _ := json.Marshal(body)
	resp, err := http.Post(server+"/api/v1/convert", "application/json", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var jr jobResp
	if err = json.NewDecoder(resp.Body).Decode(&jr); err != nil {
		return "", err
	}
	if jr.JobID == "" {
		return "", fmt.Errorf("no job_id in response")
	}
	return jr.JobID, nil
}

func pollJob(server, jobID string, onProgress func(float64)) error {
	for {
		resp, err := http.Get(server + "/api/v1/jobs/" + jobID)
		if err != nil {
			return err
		}
		var jr jobResp
		err = json.NewDecoder(resp.Body).Decode(&jr)
		resp.Body.Close()
		if err != nil {
			return err
		}

		if onProgress != nil {
			onProgress(jr.Progress)
		}

		switch jr.Status {
		case "completed":
			return nil
		case "failed", "canceled":
			msg := jr.Error
			if msg == "" {
				msg = "job " + jr.Status
			}
			return fmt.Errorf("%s", msg)
		}
		time.Sleep(2 * time.Second)
	}
}

func fetchSystemMetrics(server string) *sysSnap {
	resp, err := http.Get(server + "/api/v1/metrics/system/current")
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var snap sysSnap
	if err = json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return nil
	}
	return &snap
}

func fetchServerSummary(server string) map[string]interface{} {
	resp, err := http.Get(server + "/api/v1/metrics/summary")
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var m map[string]interface{}
	if err = json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil
	}
	return m
}

func writeJSON(path string, v interface{}) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		log.Printf("Cannot marshal JSON for %s: %v", path, err)
		return
	}
	if err = os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("Cannot write %s: %v", path, err)
		return
	}
	log.Printf("Written: %s", path)
}
