package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type TimelineClipInput struct {
	InputPath   string
	SourceStart float64
	Duration    float64
	HasVideo    bool
	HasAudio    bool
}

type TimelineExportOptions struct {
	Clips         []TimelineClipInput
	OutputPath    string
	OutputFormat  string
	FFmpegPath    string
	FFprobePath   string
	TargetWidth   int
	TargetHeight  int
	VideoCodec    *string
	AudioCodec    *string
	VideoBitrate  *string
	AudioBitrate  *string
	CRF           *int
	Preset        *string
	FPS           *int
	RemoveAudio   bool
	ResizeWidth   *int
	ResizeHeight  *int
	KeepAspect    bool
	FitMode       *string
	FastStart     bool
	StripMetadata bool
	Brightness    *float64
	Contrast      *float64
	Volume        *float64
}

func ExportTimeline(ctx context.Context, opts TimelineExportOptions, progressHandler ProgressHandler, outMetrics *FFmpegMetrics) error {
	if len(opts.Clips) == 0 {
		return fmt.Errorf("at least one clip required for timeline export")
	}
	if opts.OutputPath == "" {
		return fmt.Errorf("output path is required")
	}
	if opts.FFmpegPath == "" {
		return fmt.Errorf("ffmpeg path is required")
	}

	targetWidth, targetHeight := resolveTimelineFrameSize(
		opts.TargetWidth,
		opts.TargetHeight,
		opts.ResizeWidth,
		opts.ResizeHeight,
	)

	videoCodec := resolveTimelineVideoCodec(opts.OutputFormat, opts.VideoCodec)
	audioCodec := resolveTimelineAudioCodec(opts.OutputFormat, opts.AudioCodec)
	fps := resolveTimelineFPS(opts.FPS)

	workDir, err := os.MkdirTemp("", "ffmeditor-timeline-*")
	if err != nil {
		return fmt.Errorf("failed to create timeline workdir: %w", err)
	}
	defer os.RemoveAll(workDir)

	totalDuration := 0.0
	for _, clip := range opts.Clips {
		totalDuration += clip.Duration
	}
	if totalDuration <= 0 {
		totalDuration = float64(len(opts.Clips))
	}

	renderedDuration := 0.0
	tempClips := make([]string, 0, len(opts.Clips))

	for i, clip := range opts.Clips {
		tempPath := filepath.Join(workDir, fmt.Sprintf("clip_%03d.%s", i+1, strings.ToLower(opts.OutputFormat)))
		renderProgress := func(current, _ float64, outTimeMs float64) {
			if progressHandler == nil {
				return
			}
			weighted := renderedDuration
			if clip.Duration > 0 {
				weighted += current * clip.Duration
			}
			overall := weighted / totalDuration
			if overall > 0.95 {
				overall = 0.95
			}
			progressHandler(overall, 1.0, outTimeMs)
		}

		clipMetrics := &FFmpegMetrics{}
		renderOpts := timelineRenderOptions{
			InputPath:     clip.InputPath,
			OutputPath:    tempPath,
			Duration:      clip.Duration,
			SourceStart:   clip.SourceStart,
			HasVideo:      clip.HasVideo,
			HasAudio:      clip.HasAudio,
			OutputFormat:  opts.OutputFormat,
			FFmpegPath:    opts.FFmpegPath,
			TargetWidth:   targetWidth,
			TargetHeight:  targetHeight,
			VideoCodec:    videoCodec,
			AudioCodec:    audioCodec,
			VideoBitrate:  opts.VideoBitrate,
			AudioBitrate:  opts.AudioBitrate,
			CRF:           opts.CRF,
			Preset:        opts.Preset,
			FPS:           fps,
			RemoveAudio:   opts.RemoveAudio,
			KeepAspect:    opts.KeepAspect,
			FitMode:       opts.FitMode,
			FastStart:     false,
			StripMetadata: opts.StripMetadata,
			Brightness:    opts.Brightness,
			Contrast:      opts.Contrast,
			Volume:        opts.Volume,
		}

		if err := renderTimelineClip(ctx, renderOpts, renderProgress, clipMetrics); err != nil {
			return fmt.Errorf("rendering clip %d failed: %w", i+1, err)
		}
		// Accumulate per-clip FFmpeg metrics into the output metrics.
		if outMetrics != nil && clipMetrics.samples > 0 {
			outMetrics.update(clipMetrics.AvgSpeed, clipMetrics.AvgFPS, clipMetrics.LastBitrate)
		}
		renderedDuration += clip.Duration
		tempClips = append(tempClips, tempPath)
	}

	if progressHandler != nil {
		progressHandler(0.98, 1.0, renderedDuration*1000)
	}

	concatFile := filepath.Join(workDir, "concat.txt")
	if err := writeConcatFile(concatFile, tempClips); err != nil {
		return fmt.Errorf("failed to write concat file: %w", err)
	}

	if err := concatTimelineClips(ctx, opts.FFmpegPath, concatFile, opts.OutputPath, opts.OutputFormat, opts.FastStart); err != nil {
		return err
	}

	if progressHandler != nil {
		progressHandler(1.0, 1.0, renderedDuration*1000)
	}

	return nil
}

type timelineRenderOptions struct {
	InputPath     string
	OutputPath    string
	Duration      float64
	SourceStart   float64
	HasVideo      bool
	HasAudio      bool
	OutputFormat  string
	FFmpegPath    string
	TargetWidth   int
	TargetHeight  int
	VideoCodec    string
	AudioCodec    string
	VideoBitrate  *string
	AudioBitrate  *string
	CRF           *int
	Preset        *string
	FPS           int
	RemoveAudio   bool
	KeepAspect    bool
	FitMode       *string
	FastStart     bool
	StripMetadata bool
	Brightness    *float64
	Contrast      *float64
	Volume        *float64
}

func renderTimelineClip(ctx context.Context, opts timelineRenderOptions, progressHandler ProgressHandler, outMetrics *FFmpegMetrics) error {
	args := []string{"-y"}

	if opts.SourceStart > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", opts.SourceStart))
	}

	args = append(args, "-i", opts.InputPath)

	videoInputIndex := 0
	if !opts.HasVideo {
		videoInputIndex = 1
		args = append(args, "-f", "lavfi", "-i", fmt.Sprintf("color=c=black:s=%dx%d:d=%.3f", opts.TargetWidth, opts.TargetHeight, opts.Duration))
	}

	audioInputIndex := -1
	if !opts.RemoveAudio {
		if opts.HasAudio {
			audioInputIndex = 0
		} else {
			if opts.HasVideo {
				audioInputIndex = 1
			} else {
				audioInputIndex = 2
			}
			args = append(args, "-f", "lavfi", "-i", fmt.Sprintf("anullsrc=r=48000:cl=stereo:d=%.3f", opts.Duration))
		}
	}

	args = append(args, "-t", fmt.Sprintf("%.3f", opts.Duration))
	args = append(args, "-progress", "pipe:1", "-v", "warning")

	videoFilter := buildTimelineVideoFilter(opts.TargetWidth, opts.TargetHeight, opts.FPS, opts.KeepAspect, opts.FitMode, opts.Brightness, opts.Contrast)
	if videoFilter != "" {
		args = append(args, "-vf", videoFilter)
	}

	args = append(args, "-map", fmt.Sprintf("%d:v:0", videoInputIndex))

	if opts.RemoveAudio {
		args = append(args, "-an")
	} else {
		args = append(args, "-map", fmt.Sprintf("%d:a:0", audioInputIndex))
		args = append(args, "-c:a", opts.AudioCodec)
		args = append(args, "-ar", "48000", "-ac", "2")
		if opts.AudioBitrate != nil {
			args = append(args, "-b:a", *opts.AudioBitrate)
		}
		if opts.Volume != nil {
			args = append(args, "-af", fmt.Sprintf("volume=%f", *opts.Volume))
		}
	}

	args = append(args, "-c:v", opts.VideoCodec)
	if opts.CRF != nil {
		args = append(args, "-crf", fmt.Sprintf("%d", *opts.CRF))
	}
	if opts.VideoBitrate != nil {
		args = append(args, "-b:v", *opts.VideoBitrate)
	}
	if preset := resolveTimelinePreset(opts.Preset); preset != "" {
		args = append(args, "-preset", preset)
	}
	args = append(args, "-pix_fmt", "yuv420p")

	if opts.StripMetadata {
		args = append(args, "-map_metadata", "-1")
	}

	if opts.FastStart && strings.EqualFold(opts.OutputFormat, "mp4") {
		args = append(args, "-movflags", "+faststart")
	}

	args = append(args, opts.OutputPath)

	return runFFmpegWithProgress(ctx, opts.FFmpegPath, args, &opts.Duration, progressHandler, outMetrics)
}

func concatTimelineClips(ctx context.Context, ffmpegPath, concatFile, outputPath, outputFormat string, fastStart bool) error {
	args := []string{
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
	}

	if fastStart && strings.EqualFold(outputFormat, "mp4") {
		args = append(args, "-movflags", "+faststart")
	}

	args = append(args, outputPath)

	return runFFmpegWithProgress(ctx, ffmpegPath, args, nil, nil, nil)
}

func runFFmpegWithProgress(ctx context.Context, ffmpegPath string, args []string, totalDuration *float64, progressHandler ProgressHandler, outMetrics *FFmpegMetrics) error {
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
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
		_, _ = io.Copy(&stderrBuf, stderr)
		close(stderrDone)
	}()

	scanner := bufio.NewScanner(stdout)
	var tFrameSpeed, tFrameFPS, tFrameBitrate float64
	for scanner.Scan() {
		line := scanner.Text()
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		val = strings.TrimSpace(val)
		switch key {
		case "out_time_ms":
			if progressHandler != nil && totalDuration != nil && *totalDuration > 0 {
				if outTimeMs, err := strconv.ParseFloat(val, 64); err == nil {
					current := (outTimeMs / 1000.0) / *totalDuration
					if current < 0 {
						current = 0
					}
					if current > 1 {
						current = 1
					}
					progressHandler(current, 1.0, outTimeMs)
				}
			}
		case "fps":
			tFrameFPS, _ = strconv.ParseFloat(val, 64)
		case "speed":
			v := strings.TrimSuffix(val, "x")
			tFrameSpeed, _ = strconv.ParseFloat(v, 64)
		case "bitrate":
			v := strings.TrimSuffix(strings.TrimSuffix(val, "bits/s"), "k")
			tFrameBitrate, _ = strconv.ParseFloat(v, 64)
		case "progress":
			if outMetrics != nil {
				outMetrics.update(tFrameSpeed, tFrameFPS, tFrameBitrate)
			}
			tFrameSpeed, tFrameFPS, tFrameBitrate = 0, 0, 0
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

func writeConcatFile(path string, clips []string) error {
	var b strings.Builder
	for _, clipPath := range clips {
		b.WriteString("file ")
		b.WriteString(quoteConcatPath(clipPath))
		b.WriteString("\n")
	}

	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func quoteConcatPath(path string) string {
	safePath := filepath.ToSlash(path)
	safePath = strings.ReplaceAll(safePath, "'", `'\''`)
	return "'" + safePath + "'"
}

func resolveTimelineFrameSize(baseWidth, baseHeight int, resizeWidth, resizeHeight *int) (int, int) {
	width := baseWidth
	height := baseHeight

	if width <= 0 {
		width = 1280
	}
	if height <= 0 {
		height = 720
	}

	if resizeWidth != nil && resizeHeight != nil {
		width = *resizeWidth
		height = *resizeHeight
	} else if resizeWidth != nil && *resizeWidth > 0 {
		width = *resizeWidth
		if baseWidth > 0 && baseHeight > 0 {
			height = int(float64(width) * float64(baseHeight) / float64(baseWidth))
		}
	} else if resizeHeight != nil && *resizeHeight > 0 {
		height = *resizeHeight
		if baseWidth > 0 && baseHeight > 0 {
			width = int(float64(height) * float64(baseWidth) / float64(baseHeight))
		}
	}

	return ensureEvenPositive(width), ensureEvenPositive(height)
}

func ensureEvenPositive(value int) int {
	if value < 2 {
		value = 2
	}
	if value%2 != 0 {
		value++
	}
	return value
}

func buildTimelineVideoFilter(targetWidth, targetHeight, fps int, keepAspect bool, fitMode *string, brightness, contrast *float64) string {
	if targetWidth <= 0 || targetHeight <= 0 {
		return ""
	}

	scaleOpts := ConvertOptions{
		ResizeWidth:  &targetWidth,
		ResizeHeight: &targetHeight,
		KeepAspect:   keepAspect,
		FitMode:      fitMode,
	}

	filters := []string{}
	if scaleFilter := buildScaleFilter(scaleOpts); scaleFilter != "" {
		filters = append(filters, scaleFilter)
	}
	filters = append(filters, "setsar=1")
	if fps > 0 {
		filters = append(filters, fmt.Sprintf("fps=%d", fps))
	}

	var eqFilters []string
	if brightness != nil {
		eqFilters = append(eqFilters, fmt.Sprintf("brightness=%f", *brightness))
	}
	if contrast != nil {
		eqFilters = append(eqFilters, fmt.Sprintf("contrast=%f", *contrast))
	}
	if len(eqFilters) > 0 {
		filters = append(filters, "eq="+strings.Join(eqFilters, ":"))
	}

	return strings.Join(filters, ",")
}

func resolveTimelinePreset(preset *string) string {
	if preset == nil || strings.TrimSpace(*preset) == "" {
		return "fast"
	}
	return *preset
}

func resolveTimelineFPS(fps *int) int {
	if fps == nil || *fps <= 0 {
		return 30
	}
	return *fps
}

func resolveTimelineVideoCodec(outputFormat string, requested *string) string {
	if requested != nil {
		codec := strings.ToLower(strings.TrimSpace(*requested))
		if codec != "" && codec != "copy" {
			return codec
		}
	}

	switch strings.ToLower(outputFormat) {
	case "webm":
		return "libvpx-vp9"
	default:
		return "libx264"
	}
}

func resolveTimelineAudioCodec(outputFormat string, requested *string) string {
	if requested != nil {
		codec := strings.ToLower(strings.TrimSpace(*requested))
		if codec != "" && codec != "copy" {
			return codec
		}
	}

	switch strings.ToLower(outputFormat) {
	case "webm":
		return "libopus"
	default:
		return "aac"
	}
}
