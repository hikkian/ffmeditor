package ffmpeg

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

type ConvertOptions struct {
	InputPath     string
	OutputPath    string
	FFmpegPath    string
	FFprobePath   string
	VideoCodec    *string
	AudioCodec    *string
	VideoBitrate  *string
	AudioBitrate  *string
	CRF           *int
	Preset        *string
	FPS           *int
	RemoveAudio   bool
	RemoveVideo   bool
	TrimStart     *float64
	TrimDuration  *float64
	ResizeWidth   *int
	ResizeHeight  *int
	KeepAspect    bool
	FitMode       *string
	FastStart     bool
	StripMetadata bool
	PresetMode    string // "low_cpu", "balanced", "quality"
}

type ProgressHandler func(current, total float64, out_time_ms float64)

func GetMediaInfo(ctx context.Context, ffprobePath, inputPath string) (*MediaInfo, error) {
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-show_format",
		"-show_streams",
		"-print_json",
		inputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	info := parseFFprobeOutput(string(output))
	return info, nil
}

type MediaInfo struct {
	Duration   *float64
	HasVideo   bool
	HasAudio   bool
	VideoCodec string
	AudioCodec string
	Resolution string
}

func parseFFprobeOutput(jsonOutput string) *MediaInfo {
	info := &MediaInfo{}

	// Simple JSON parsing for duration
	if idx := strings.Index(jsonOutput, `"duration"`); idx != -1 {
		endIdx := strings.Index(jsonOutput[idx:], ",")
		if endIdx == -1 {
			endIdx = strings.Index(jsonOutput[idx:], "}")
		}
		durationStr := jsonOutput[idx+11 : idx+endIdx]
		durationStr = strings.TrimSpace(durationStr)
		if duration, err := strconv.ParseFloat(durationStr, 64); err == nil {
			info.Duration = &duration
		}
	}

	// Check for streams
	if strings.Contains(jsonOutput, `"codec_type": "video"`) {
		info.HasVideo = true
		if idx := strings.Index(jsonOutput, `"codec_name"`); idx != -1 {
			endIdx := strings.Index(jsonOutput[idx:], `"`)
			if endIdx > 0 {
				codecName := strings.TrimSpace(jsonOutput[idx+14 : idx+endIdx])
				info.VideoCodec = strings.Trim(codecName, `"`)
			}
		}
	}
	if strings.Contains(jsonOutput, `"codec_type": "audio"`) {
		info.HasAudio = true
	}

	return info
}

func Convert(ctx context.Context, opts ConvertOptions, progressHandler ProgressHandler) error {
	// Check if input file exists
	if _, err := os.Stat(opts.InputPath); os.IsNotExist(err) {
		return fmt.Errorf("input file not found: %s", opts.InputPath)
	}

	// Get total duration
	var totalDuration *float64
	if mediaInfo, err := GetMediaInfo(ctx, opts.FFprobePath, opts.InputPath); err == nil && mediaInfo.Duration != nil {
		totalDuration = mediaInfo.Duration
	}

	// Build FFmpeg command arguments
	args := []string{
		"-i", opts.InputPath,
		"-progress", "pipe:1",
		"-v", "warning",
	}

	// Handle trim
	if opts.TrimStart != nil || opts.TrimDuration != nil {
		if opts.TrimStart != nil {
			args = append(args, "-ss", fmt.Sprintf("%.2f", *opts.TrimStart))
		}
		if opts.TrimDuration != nil {
			args = append(args, "-t", fmt.Sprintf("%.2f", *opts.TrimDuration))
		}
	}

	// Handle video codec and settings
	if opts.RemoveVideo {
		args = append(args, "-vn")
	} else {
		if opts.VideoCodec != nil {
			args = append(args, "-c:v", *opts.VideoCodec)
		}

		// Preset
		preset := getPreset(opts)
		if opts.VideoCodec != nil && (*opts.VideoCodec == "libx264" || *opts.VideoCodec == "libx265") {
			args = append(args, "-preset", preset)
		}

		// CRF
		if opts.CRF != nil {
			args = append(args, "-crf", fmt.Sprintf("%d", *opts.CRF))
		}

		// Bitrate
		if opts.VideoBitrate != nil {
			args = append(args, "-b:v", *opts.VideoBitrate)
		}

		// FPS
		if opts.FPS != nil {
			args = append(args, "-r", fmt.Sprintf("%d", *opts.FPS))
		}

		// Resize and fit
		if opts.ResizeWidth != nil || opts.ResizeHeight != nil {
			scaleFilter := buildScaleFilter(opts)
			args = append(args, "-vf", scaleFilter)
		}
	}

	// Handle audio codec and settings
	if opts.RemoveAudio {
		args = append(args, "-an")
	} else {
		if opts.AudioCodec != nil {
			args = append(args, "-c:a", *opts.AudioCodec)
		}
		if opts.AudioBitrate != nil {
			args = append(args, "-b:a", *opts.AudioBitrate)
		}
	}

	// Strip metadata
	if opts.StripMetadata {
		args = append(args, "-map_metadata", "-1")
	}

	// Fast start for MP4
	if opts.FastStart && strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}

	// Output path and format
	args = append(args, "-y", opts.OutputPath)

	cmd := exec.CommandContext(ctx, opts.FFmpegPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Parse progress
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if progressHandler != nil && strings.HasPrefix(line, "out_time_ms=") {
			outTimeStr := strings.TrimPrefix(line, "out_time_ms=")
			if outTimeMs, err := strconv.ParseFloat(outTimeStr, 64); err == nil {
				if totalDuration != nil && *totalDuration > 0 {
					current := (outTimeMs / 1000.0) / *totalDuration
					progressHandler(current, 1.0, outTimeMs)
				}
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w", err)
	}

	return nil
}

func getPreset(opts ConvertOptions) string {
	if opts.Preset != nil {
		return *opts.Preset
	}

	switch opts.PresetMode {
	case "low_cpu":
		return "veryfast"
	case "balanced":
		return "fast"
	case "quality":
		return "slow"
	default:
		return "fast"
	}
}

func buildScaleFilter(opts ConvertOptions) string {
	if opts.ResizeWidth == nil && opts.ResizeHeight == nil {
		return ""
	}

	w := -1
	h := -1

	if opts.ResizeWidth != nil {
		w = *opts.ResizeWidth
	}
	if opts.ResizeHeight != nil {
		h = *opts.ResizeHeight
	}

	if !opts.KeepAspect {
		return fmt.Sprintf("scale=%d:%d", w, h)
	}

	// Keep aspect ratio
	if opts.FitMode != nil && *opts.FitMode == "cover" {
		// Crop to fit
		if w > 0 && h > 0 {
			return fmt.Sprintf("scale=iw*min(1\\,min(%d/iw\\,%d/ih)):ih*min(1\\,min(%d/iw\\,%d/ih)),pad=%d:%d:(ow-iw)/2:(oh-ih)/2", w, h, w, h, w, h)
		}
	}

	// Default: contain (pad/letterbox)
	if w > 0 && h > 0 {
		return fmt.Sprintf("scale=min(%d\\,iw*%d/ih):min(%d\\,ih*%d/iw),pad=%d:%d:(ow-iw)/2:(oh-ih)/2", w, h, h, w, w, h)
	}

	// Only width specified
	if w > 0 {
		return fmt.Sprintf("scale=%d:-1", w)
	}

	// Only height specified
	if h > 0 {
		return fmt.Sprintf("scale=-1:%d", h)
	}

	return ""
}

// ProbeInput returns duration in seconds
func ProbeInput(ctx context.Context, ffprobePath, inputPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1:noprint_section_header=1",
		inputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	durationStr := strings.TrimSpace(string(output))
	duration, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration: %w", err)
	}

	return duration, nil
}
