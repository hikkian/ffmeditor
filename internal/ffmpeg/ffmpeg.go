package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"ffmeditor/internal/models"
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
	Brightness    *float64
	Contrast      *float64
	Volume        *float64
}

type ProgressHandler func(current, total float64, out_time_ms float64)

// FFmpegMetrics captures real-time statistics reported by FFmpeg via -progress.
type FFmpegMetrics struct {
	LastSpeed   float64 // last reported speed multiplier (e.g. 1.52)
	LastFPS     float64 // last reported encoding FPS
	LastBitrate float64 // last reported bitrate in kbits/s
	AvgSpeed    float64 // rolling average over all progress updates
	AvgFPS      float64 // rolling average over all progress updates
	samples     int
}

func (m *FFmpegMetrics) update(speed, fps, bitrate float64) {
	m.LastSpeed = speed
	m.LastFPS = fps
	m.LastBitrate = bitrate
	m.samples++
	if speed > 0 {
		m.AvgSpeed += (speed - m.AvgSpeed) / float64(m.samples)
	}
	if fps > 0 {
		m.AvgFPS += (fps - m.AvgFPS) / float64(m.samples)
	}
}

type mergeClipInfo struct {
	HasVideo bool
	HasAudio bool
	Duration float64
}

func GetMediaInfo(ctx context.Context, ffprobePath, inputPath string) (*models.MediaInfo, error) {
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-show_format",
		"-show_streams",
		"-of", "json",
		inputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	info, err := parseFFprobeOutput(output)
	if err != nil {
		return nil, err
	}
	return info, nil
}


type ffprobeOutput struct {
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
	Streams []struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	} `json:"streams"`
}

func parseFFprobeOutput(jsonOutput []byte) (*models.MediaInfo, error) {
	var probe ffprobeOutput
	if err := json.Unmarshal(jsonOutput, &probe); err != nil {
		return nil, fmt.Errorf("ffprobe json parse failed: %w", err)
	}

	info := &models.MediaInfo{}
	if probe.Format.Duration != "" {
		if duration, err := strconv.ParseFloat(probe.Format.Duration, 64); err == nil {
			info.Duration = &duration
		}
	}

	for _, stream := range probe.Streams {
		switch stream.CodecType {
		case "video":
			info.HasVideo = true
			if info.VideoCodec == "" {
				info.VideoCodec = stream.CodecName
			}
			if stream.Width > 0 && stream.Height > 0 && info.Resolution == "" {
				info.Resolution = fmt.Sprintf("%dx%d", stream.Width, stream.Height)
			}
		case "audio":
			info.HasAudio = true
			if info.AudioCodec == "" {
				info.AudioCodec = stream.CodecName
			}
		}
	}

	return info, nil
}

func Convert(ctx context.Context, opts ConvertOptions, progressHandler ProgressHandler, outMetrics *FFmpegMetrics) error {
	// Check if input file exists
	if _, err := os.Stat(opts.InputPath); os.IsNotExist(err) {
		return fmt.Errorf("input file not found: %s", opts.InputPath)
	}

	// Get total duration for progress tracking.
	// Adjust for trim so the progress bar reflects actual output length.
	var totalDuration *float64
	if mediaInfo, err := GetMediaInfo(ctx, opts.FFprobePath, opts.InputPath); err == nil && mediaInfo.Duration != nil {
		d := *mediaInfo.Duration
		if opts.TrimStart != nil && *opts.TrimStart > 0 {
			d -= *opts.TrimStart
		}
		if opts.TrimDuration != nil && *opts.TrimDuration > 0 && *opts.TrimDuration < d {
			d = *opts.TrimDuration
		}
		if d > 0 {
			totalDuration = &d
		}
	}

	// Build FFmpeg command arguments.
	// IMPORTANT: -ss must come BEFORE -i to use fast input seeking.
	// Placing -ss after -i forces FFmpeg to decode every frame from the start,
	// which is extremely slow for large files trimmed from the middle.
	args := []string{}
	if opts.TrimStart != nil && *opts.TrimStart > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", *opts.TrimStart))
	}
	args = append(args,
		"-i", opts.InputPath,
		"-progress", "pipe:1",
		"-v", "warning",
	)
	// Duration limit: how much to encode from the seek point.
	if opts.TrimDuration != nil {
		args = append(args, "-t", fmt.Sprintf("%.3f", *opts.TrimDuration))
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

		// Filters
		var videoFilters []string

		// Resize and fit
		if opts.ResizeWidth != nil || opts.ResizeHeight != nil {
			scaleFilter := buildScaleFilter(opts)
			if scaleFilter != "" {
				videoFilters = append(videoFilters, scaleFilter)
			}
		}

		// Brightness and contrast
		var eqFilters []string
		if opts.Brightness != nil {
			eqFilters = append(eqFilters, fmt.Sprintf("brightness=%f", *opts.Brightness))
		}
		if opts.Contrast != nil {
			eqFilters = append(eqFilters, fmt.Sprintf("contrast=%f", *opts.Contrast))
		}
		if len(eqFilters) > 0 {
			videoFilters = append(videoFilters, "eq="+strings.Join(eqFilters, ":"))
		}

		if len(videoFilters) > 0 {
			args = append(args, "-vf", strings.Join(videoFilters, ","))
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
		// Volume filter
		if opts.Volume != nil {
			args = append(args, "-af", fmt.Sprintf("volume=%f", *opts.Volume))
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
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	var stderrBuf bytes.Buffer
	stderrDone := make(chan struct{})
	go func() {
		// Limit stderr capture to 64KB
		limitedStderr := io.LimitReader(stderr, 64*1024)
		_, _ = io.Copy(&stderrBuf, limitedStderr)
		close(stderrDone)
	}()

	// Parse FFmpeg -progress pipe:1 output.
	// Each "frame" ends with progress=continue or progress=end.
	// We collect multiple fields from the same frame to pass to outMetrics.
	scanner := bufio.NewScanner(stdout)
	var frameSpeed, frameFPS, frameBitrate float64
	for scanner.Scan() {
		line := scanner.Text()
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		val = strings.TrimSpace(val)
		switch key {
		case "out_time_ms":
			if outTimeMs, err := strconv.ParseFloat(val, 64); err == nil {
				if progressHandler != nil && totalDuration != nil && *totalDuration > 0 {
					current := (outTimeMs / 1000.0) / *totalDuration
					progressHandler(current, 1.0, outTimeMs)
				}
			}
		case "fps":
			frameFPS, _ = strconv.ParseFloat(val, 64)
		case "speed":
			// speed is reported as "1.52x" or "N/A"
			val = strings.TrimSuffix(val, "x")
			frameSpeed, _ = strconv.ParseFloat(val, 64)
		case "bitrate":
			// bitrate is reported as "128.0kbits/s" or "N/A"
			val = strings.TrimSuffix(val, "bits/s")
			val = strings.TrimSuffix(val, "k")
			frameBitrate, _ = strconv.ParseFloat(val, 64)
		case "progress":
			// progress=continue or progress=end marks end of one stats block
			if outMetrics != nil {
				outMetrics.update(frameSpeed, frameFPS, frameBitrate)
			}
			frameSpeed, frameFPS, frameBitrate = 0, 0, 0
		}
	}
	if scanErr := scanner.Err(); scanErr != nil {
		<-stderrDone
		return fmt.Errorf("ffmpeg output scan failed: %w: %s", scanErr, strings.TrimSpace(stderrBuf.String()))
	}

	if err := cmd.Wait(); err != nil {
		<-stderrDone
		stderrText := strings.TrimSpace(stderrBuf.String())
		if stderrText != "" {
			return fmt.Errorf("ffmpeg failed: %w: %s", err, stderrText)
		}
		return fmt.Errorf("ffmpeg failed: %w", err)
	}
	<-stderrDone

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

type MergeOptions struct {
	InputPaths  []string
	OutputPath  string
	FFmpegPath  string
	FFprobePath string
}

func Merge(ctx context.Context, opts MergeOptions, progressHandler ProgressHandler, outMetrics *FFmpegMetrics) error {
	if len(opts.InputPaths) < 2 {
		return fmt.Errorf("at least 2 files required for merging")
	}

	// 1. Probe all files to get info
	infos := make([]*mergeClipInfo, len(opts.InputPaths))
	var targetWidth, targetHeight int

	for i, path := range opts.InputPaths {
		info, err := GetMediaInfo(ctx, opts.FFprobePath, path)
		if err != nil {
			return fmt.Errorf("failed to probe %s: %w", path, err)
		}
		clipDuration := 1.0
		if info.Duration != nil && *info.Duration > 0 {
			clipDuration = *info.Duration
		}
		infos[i] = &mergeClipInfo{
			HasVideo: info.HasVideo,
			HasAudio: info.HasAudio,
			Duration: clipDuration,
		}

		// Use the first video stream's resolution as target
		if targetWidth == 0 && info.HasVideo && info.Resolution != "" {
			parts := strings.Split(info.Resolution, "x")
			if len(parts) == 2 {
				w, _ := strconv.Atoi(parts[0])
				h, _ := strconv.Atoi(parts[1])
				targetWidth = w
				targetHeight = h
			}
		}
	}

	// Defaults if no video resolution found
	if targetWidth == 0 {
		targetWidth = 1280
		targetHeight = 720
	}

	// 2. Build FFmpeg command arguments
	args := []string{}

	// Add inputs. If we need silent audio, we add anullsrc as an extra input.
	for _, path := range opts.InputPaths {
		args = append(args, "-i", path)
	}

	// Add silent audio source if any file lacks audio but we want mono/stereo output
	// We'll use a virtual input for silence if needed.
	// Actually, it's easier to use 'anullsrc' in the filter complex logic.
	// But anullsrc needs a duration or it's infinite.
	// A better way: for each input without audio, generate silence in the filter.

	args = append(args, "-progress", "pipe:1", "-v", "warning")

	// 3. Build Filter Complex
	// For each input, we ensure it has a video of target resolution and an audio stream.
	var filterComplex strings.Builder
	var concatInputs strings.Builder

	for i, info := range infos {
		// Video processing: scale and pad to target resolution
		// [i:v]scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2[v_i]
		if info.HasVideo {
			fmt.Fprintf(&filterComplex, "[%d:v]scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1[v%d];",
				i, targetWidth, targetHeight, targetWidth, targetHeight, i)
		} else {
			// If no video, create a black screen?
			// For now let's assume all have video since it's a video editor.
			// If no video, we create one from black.
			fmt.Fprintf(&filterComplex, "color=c=black:s=%dx%d:d=%.3f[v%d];", targetWidth, targetHeight, info.Duration, i)
		}

		// Audio processing
		if info.HasAudio {
			fmt.Fprintf(&filterComplex, "[%d:a]aresample=44100:async=1[a%d];", i, i)
		} else {
			// Generate silence that matches the clip duration so concat can terminate cleanly.
			fmt.Fprintf(&filterComplex, "aevalsrc=0:d=%.3f,aresample=44100[a%d];", info.Duration, i)
		}

		fmt.Fprintf(&concatInputs, "[v%d][a%d]", i, i)
	}

	fmt.Fprintf(&filterComplex, "%sconcat=n=%d:v=1:a=1[outv][outa]", concatInputs.String(), len(opts.InputPaths))

	args = append(args, "-filter_complex", filterComplex.String())
	args = append(args, "-map", "[outv]", "-map", "[outa]")

	// Output settings
	args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-c:a", "aac", "-b:a", "128k")
	args = append(args, "-shortest", "-y", opts.OutputPath)

	cmd := exec.CommandContext(ctx, opts.FFmpegPath, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg merge: %w", err)
	}

	var stderrBuf bytes.Buffer
	stderrDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(&stderrBuf, stderr)
		close(stderrDone)
	}()

	scanner := bufio.NewScanner(stdout)
	var mFrameSpeed, mFrameFPS, mFrameBitrate float64
	for scanner.Scan() {
		line := scanner.Text()
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		val = strings.TrimSpace(val)
		switch key {
		case "out_time_ms":
			if outTimeMs, err := strconv.ParseFloat(val, 64); err == nil && progressHandler != nil {
				progressHandler(0, 0, outTimeMs)
			}
		case "fps":
			mFrameFPS, _ = strconv.ParseFloat(val, 64)
		case "speed":
			v := strings.TrimSuffix(val, "x")
			mFrameSpeed, _ = strconv.ParseFloat(v, 64)
		case "bitrate":
			v := strings.TrimSuffix(strings.TrimSuffix(val, "bits/s"), "k")
			mFrameBitrate, _ = strconv.ParseFloat(v, 64)
		case "progress":
			if outMetrics != nil {
				outMetrics.update(mFrameSpeed, mFrameFPS, mFrameBitrate)
			}
			mFrameSpeed, mFrameFPS, mFrameBitrate = 0, 0, 0
		}
	}
	if scanErr := scanner.Err(); scanErr != nil {
		<-stderrDone
		return fmt.Errorf("ffmpeg merge output scan failed: %w: %s", scanErr, strings.TrimSpace(stderrBuf.String()))
	}

	if err := cmd.Wait(); err != nil {
		<-stderrDone
		stderrText := strings.TrimSpace(stderrBuf.String())
		if stderrText != "" {
			return fmt.Errorf("ffmpeg merge failed: %w: %s", err, stderrText)
		}
		return fmt.Errorf("ffmpeg merge failed: %w", err)
	}
	<-stderrDone

	return nil
}
