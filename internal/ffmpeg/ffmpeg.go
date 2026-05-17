package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ProgressHandler receives normalised progress [0,1] and raw out_time_ms.
type ProgressHandler func(current, total float64, outTimeMs float64)

// ─── Media Info ───────────────────────────────────────────────────────────────

type MediaInfo struct {
	Duration   *float64
	HasVideo   bool
	HasAudio   bool
	VideoCodec string
	AudioCodec string
	Resolution string
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

func GetMediaInfo(ctx context.Context, ffprobePath, inputPath string) (*MediaInfo, error) {
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
	return parseFFprobeOutput(output)
}

func parseFFprobeOutput(data []byte) (*MediaInfo, error) {
	var probe ffprobeOutput
	if err := json.Unmarshal(data, &probe); err != nil {
		return nil, fmt.Errorf("ffprobe json parse failed: %w", err)
	}
	info := &MediaInfo{}
	if probe.Format.Duration != "" {
		if d, err := strconv.ParseFloat(probe.Format.Duration, 64); err == nil {
			info.Duration = &d
		}
	}
	for _, s := range probe.Streams {
		switch s.CodecType {
		case "video":
			info.HasVideo = true
			if info.VideoCodec == "" {
				info.VideoCodec = s.CodecName
			}
			if s.Width > 0 && s.Height > 0 && info.Resolution == "" {
				info.Resolution = fmt.Sprintf("%dx%d", s.Width, s.Height)
			}
		case "audio":
			info.HasAudio = true
			if info.AudioCodec == "" {
				info.AudioCodec = s.CodecName
			}
		}
	}
	return info, nil
}

// ─── Hardware Acceleration ────────────────────────────────────────────────────

// DetectHardwareEncoder returns "nvenc", "qsv", "videotoolbox", or "".
func GenerateWaveform(ctx context.Context, ffmpegPath, inputPath string, barCount int) ([]int, error) {
	if barCount <= 0 {
		barCount = 160
	}

	cmd := exec.CommandContext(ctx, ffmpegPath,
		"-i", inputPath,
		"-vn",
		"-ac", "1",
		"-ar", "4000",
		"-f", "f32le",
		"-",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("waveform stdout pipe: %w", err)
	}

	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("waveform ffmpeg start: %w", err)
	}

	raw, readErr := io.ReadAll(io.LimitReader(stdout, 64*1024*1024))
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, fmt.Errorf("waveform read failed: %w", readErr)
	}
	if waitErr != nil {
		if text := strings.TrimSpace(errBuf.String()); text != "" {
			return nil, fmt.Errorf("waveform ffmpeg: %w: %s", waitErr, text)
		}
		return nil, fmt.Errorf("waveform ffmpeg: %w", waitErr)
	}

	sampleCount := len(raw) / 4
	if sampleCount == 0 {
		return []int{}, nil
	}

	samplesPerBar := int(math.Max(1, float64(sampleCount)/float64(barCount)))
	peaks := make([]float64, 0, barCount)
	for start := 0; start < sampleCount; start += samplesPerBar {
		end := start + samplesPerBar
		if end > sampleCount {
			end = sampleCount
		}

		maxPeak := 0.0
		for i := start; i < end; i++ {
			bits := binary.LittleEndian.Uint32(raw[i*4 : i*4+4])
			sample := math.Abs(float64(math.Float32frombits(bits)))
			if sample > maxPeak {
				maxPeak = sample
			}
		}
		peaks = append(peaks, maxPeak)
	}

	peakMax := 0.001
	for _, peak := range peaks {
		if peak > peakMax {
			peakMax = peak
		}
	}

	waveform := make([]int, 0, len(peaks))
	for _, peak := range peaks {
		normalized := peak / peakMax
		waveform = append(waveform, int(math.Max(8, math.Round(normalized*100))))
	}

	return waveform, nil
}

func DetectHardwareEncoder(ffmpegPath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, ffmpegPath, "-encoders", "-v", "quiet").Output()
	if err != nil {
		return ""
	}
	s := string(out)
	switch {
	case strings.Contains(s, "h264_nvenc"):
		return "nvenc"
	case strings.Contains(s, "h264_qsv"):
		return "qsv"
	case strings.Contains(s, "h264_videotoolbox"):
		return "videotoolbox"
	default:
		return ""
	}
}

func hwCodecName(accel string) string {
	return HWEncoderCodec(accel)
}

// HWEncoderCodec converts an accel name ("nvenc", "qsv", "videotoolbox") to the
// ffmpeg codec string, or "" if accel is empty/unknown (caller uses libx264).
func HWEncoderCodec(accel string) string {
	switch accel {
	case "nvenc":
		return "h264_nvenc"
	case "qsv":
		return "h264_qsv"
	case "videotoolbox":
		return "h264_videotoolbox"
	default:
		return ""
	}
}

// ─── Single-file Convert ──────────────────────────────────────────────────────

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
	PresetMode    string
	Brightness    *float64
	Contrast      *float64
	Volume        *float64
}

func Convert(ctx context.Context, opts ConvertOptions, ph ProgressHandler) error {
	if _, err := os.Stat(opts.InputPath); os.IsNotExist(err) {
		return fmt.Errorf("input file not found: %s", opts.InputPath)
	}

	var totalDuration *float64
	if info, err := GetMediaInfo(ctx, opts.FFprobePath, opts.InputPath); err == nil && info.Duration != nil {
		totalDuration = info.Duration
	}

	// -ss BEFORE -i = keyframe-based input seeking (fast).
	// -ss after -i would decode from the start (accurate but slow for large files).
	args := []string{}
	if opts.TrimStart != nil {
		args = append(args, "-ss", fmt.Sprintf("%.6f", *opts.TrimStart))
	}
	args = append(args, "-i", opts.InputPath, "-progress", "pipe:1", "-v", "warning")
	if opts.TrimDuration != nil {
		args = append(args, "-t", fmt.Sprintf("%.6f", *opts.TrimDuration))
	}

	// Video
	if opts.RemoveVideo {
		args = append(args, "-vn")
	} else {
		if opts.VideoCodec != nil {
			args = append(args, "-c:v", *opts.VideoCodec)
		}
		preset := getPreset(opts)
		if opts.VideoCodec != nil && (*opts.VideoCodec == "libx264" || *opts.VideoCodec == "libx265") {
			args = append(args, "-preset", preset)
		}
		if opts.CRF != nil {
			args = append(args, "-crf", fmt.Sprintf("%d", *opts.CRF))
		}
		if opts.VideoBitrate != nil {
			args = append(args, "-b:v", *opts.VideoBitrate)
		}
		if opts.FPS != nil {
			args = append(args, "-r", fmt.Sprintf("%d", *opts.FPS))
		}
		var vf []string
		if opts.ResizeWidth != nil || opts.ResizeHeight != nil {
			if f := buildScaleFilter(opts); f != "" {
				vf = append(vf, f)
			}
		}
		var eq []string
		if opts.Brightness != nil {
			eq = append(eq, fmt.Sprintf("brightness=%f", *opts.Brightness))
		}
		if opts.Contrast != nil {
			eq = append(eq, fmt.Sprintf("contrast=%f", *opts.Contrast))
		}
		if len(eq) > 0 {
			vf = append(vf, "eq="+strings.Join(eq, ":"))
		}
		if len(vf) > 0 {
			args = append(args, "-vf", strings.Join(vf, ","))
		}
	}

	// Audio
	if opts.RemoveAudio {
		args = append(args, "-an")
	} else {
		if opts.AudioCodec != nil {
			args = append(args, "-c:a", *opts.AudioCodec)
		}
		if opts.AudioBitrate != nil {
			args = append(args, "-b:a", *opts.AudioBitrate)
		}
		if opts.Volume != nil {
			args = append(args, "-af", fmt.Sprintf("volume=%f", *opts.Volume))
		}
	}

	if opts.StripMetadata {
		args = append(args, "-map_metadata", "-1")
	}
	if opts.FastStart && strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, "-y", opts.OutputPath)

	return runFFmpeg(ctx, opts.FFmpegPath, args, totalDuration, ph)
}

// ─── Timeline / EDL Export ────────────────────────────────────────────────────

// TimelineExportClip is one resolved segment (file path already looked up by handler).
type TimelineExportClip struct {
	FileID      string
	FilePath    string
	SourceStart float64
	Duration    float64
	HasVideo    bool
	HasAudio    bool
}

type TimelineExportOptions struct {
	Clips        []TimelineExportClip
	OutputPath   string
	FFmpegPath   string
	FFprobePath  string
	VideoCodec   *string
	AudioCodec   *string
	VideoBitrate *string
	AudioBitrate *string
	CRF          *int
	Preset       *string
	RemoveAudio  bool
	FastStart    bool
	ResizeWidth  *int
	ResizeHeight *int
	KeepAspect   bool
	FitMode      *string
	Brightness   *float64
	Contrast     *float64
	Volume       *float64
	PresetMode string
	// "fast" (default) = stream-copy + concat demuxer (keyframe-accurate, no re-encode).
	// "precise" = filter_complex re-encode (frame-accurate, slower).
	Mode string
	// HWEncoder is the detected hardware codec (e.g. "h264_nvenc"). Empty = use libx264.
	HWEncoder string
}

// CanStreamCopy reports whether stream-copy is safe for this export (no filters/re-encode needed).
func CanStreamCopy(opts TimelineExportOptions) bool {
	if opts.Mode == "precise" {
		return false
	}
	if opts.ResizeWidth != nil || opts.ResizeHeight != nil {
		return false
	}
	if opts.Brightness != nil || opts.Contrast != nil {
		return false
	}
	if opts.Volume != nil {
		return false
	}
	return true
}

// TimelineExport assembles an EDL clip list into a single output file.
// onStage (may be nil) receives human-readable stage names.
func TimelineExport(ctx context.Context, opts TimelineExportOptions, ph ProgressHandler, onStage func(string)) error {
	if len(opts.Clips) == 0 {
		return fmt.Errorf("no clips provided")
	}
	stage := func(s string) {
		if onStage != nil {
			onStage(s)
		}
	}
	if CanStreamCopy(opts) {
		return timelineExportFast(ctx, opts, ph, stage)
	}
	return timelineExportReencode(ctx, opts, ph, stage)
}

// timelineExportFast extracts each segment with -c copy, then uses the concat
// demuxer. No re-encoding — extremely fast even for large files.
func timelineExportFast(ctx context.Context, opts TimelineExportOptions, ph ProgressHandler, onStage func(string)) error {
	totalDuration := 0.0
	for _, c := range opts.Clips {
		totalDuration += c.Duration
	}

	// Single-clip fast path: extract directly to output — no temp dir, no concat.
	if len(opts.Clips) == 1 {
		clip := opts.Clips[0]
		onStage("extracting")
		args := []string{
			"-ss", fmt.Sprintf("%.6f", clip.SourceStart),
			"-t", fmt.Sprintf("%.6f", clip.Duration),
			"-i", clip.FilePath,
			"-c", "copy",
			"-avoid_negative_ts", "make_zero",
		}
		if opts.RemoveAudio {
			args = append(args, "-an")
		}
		if opts.FastStart && strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
			args = append(args, "-movflags", "+faststart")
		}
		args = append(args, "-progress", "pipe:1", "-v", "warning", "-y", opts.OutputPath)
		onStage("finalizing")
		return runFFmpeg(ctx, opts.FFmpegPath, args, &totalDuration, ph)
	}

	tmpDir, err := os.MkdirTemp("", "ffm_export_*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	ext := filepath.Ext(opts.OutputPath)
	if ext == "" {
		ext = ".mp4"
	}

	// Phase 1: extract each segment (85% of total progress)
	segPaths := make([]string, 0, len(opts.Clips))
	var done float64

	for i, clip := range opts.Clips {
		onStage(fmt.Sprintf("extracting segment %d/%d", i+1, len(opts.Clips)))
		segPath := filepath.Join(tmpDir, fmt.Sprintf("seg_%d%s", i, ext))
		segPaths = append(segPaths, segPath)

		args := []string{
			"-ss", fmt.Sprintf("%.6f", clip.SourceStart),
			"-t", fmt.Sprintf("%.6f", clip.Duration),
			"-i", clip.FilePath,
			"-c", "copy",
			"-avoid_negative_ts", "make_zero",
			"-y", segPath,
		}

		cmd := exec.CommandContext(ctx, opts.FFmpegPath, args...)
		var errBuf bytes.Buffer
		cmd.Stderr = &errBuf
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("segment %d extraction failed: %w: %s", i, err, errBuf.String())
		}

		done += clip.Duration
		if ph != nil && totalDuration > 0 {
			ph((done/totalDuration)*0.85, 1.0, done*1000)
		}
	}

	// Phase 2: concat demuxer (15% of total progress)
	onStage("concatenating")

	var listContent strings.Builder
	for _, seg := range segPaths {
		abs, _ := filepath.Abs(seg)
		// FFmpeg concat list requires forward slashes and escaped single-quotes.
		fwd := strings.ReplaceAll(abs, "\\", "/")
		escaped := strings.ReplaceAll(fwd, "'", `'\''`)
		fmt.Fprintf(&listContent, "file '%s'\n", escaped)
	}
	listPath := filepath.Join(tmpDir, "list.txt")
	if err := os.WriteFile(listPath, []byte(listContent.String()), 0644); err != nil {
		return fmt.Errorf("failed to write concat list: %w", err)
	}

	concatArgs := []string{
		"-f", "concat", "-safe", "0",
		"-i", listPath,
		"-c", "copy",
	}
	if opts.RemoveAudio {
		concatArgs = append(concatArgs, "-an")
	}
	if opts.FastStart && strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
		concatArgs = append(concatArgs, "-movflags", "+faststart")
	}
	concatArgs = append(concatArgs, "-progress", "pipe:1", "-v", "warning", "-y", opts.OutputPath)

	var concatPH ProgressHandler
	if ph != nil && totalDuration > 0 {
		concatPH = func(_, _ float64, outTimeMs float64) {
			p := (outTimeMs / 1000.0) / totalDuration
			ph(0.85+p*0.15, 1.0, outTimeMs)
		}
	}

	onStage("finalizing")
	return runFFmpeg(ctx, opts.FFmpegPath, concatArgs, nil, concatPH)
}

// timelineExportReencode uses a single filter_complex call for frame-accurate
// output with optional resize, colour, and volume effects.
func timelineExportReencode(ctx context.Context, opts TimelineExportOptions, ph ProgressHandler, onStage func(string)) error {
	onStage("preparing")

	totalDuration := 0.0
	for _, c := range opts.Clips {
		totalDuration += c.Duration
	}

	// -ss / -t before each -i for fast input seeking.
	args := []string{"-progress", "pipe:1", "-v", "warning"}
	for _, clip := range opts.Clips {
		args = append(args,
			"-ss", fmt.Sprintf("%.6f", clip.SourceStart),
			"-t", fmt.Sprintf("%.6f", clip.Duration),
			"-i", clip.FilePath,
		)
	}

	n := len(opts.Clips)
	hasAudio := !opts.RemoveAudio

	// Build per-clip video filter.
	var vfParts []string
	if opts.ResizeWidth != nil || opts.ResizeHeight != nil {
		w, h := -1, -1
		if opts.ResizeWidth != nil {
			w = *opts.ResizeWidth
		}
		if opts.ResizeHeight != nil {
			h = *opts.ResizeHeight
		}
		if opts.KeepAspect {
			if w > 0 && h > 0 {
				vfParts = append(vfParts, fmt.Sprintf(
					"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1",
					w, h, w, h))
			} else if w > 0 {
				vfParts = append(vfParts, fmt.Sprintf("scale=%d:-2", w))
			} else {
				vfParts = append(vfParts, fmt.Sprintf("scale=-2:%d", h))
			}
		} else {
			vfParts = append(vfParts, fmt.Sprintf("scale=%d:%d", w, h))
		}
	}
	var eq []string
	if opts.Brightness != nil {
		eq = append(eq, fmt.Sprintf("brightness=%f", *opts.Brightness))
	}
	if opts.Contrast != nil {
		eq = append(eq, fmt.Sprintf("contrast=%f", *opts.Contrast))
	}
	if len(eq) > 0 {
		vfParts = append(vfParts, "eq="+strings.Join(eq, ":"))
	}

	var fc, concatV, concatA strings.Builder
	for i := range opts.Clips {
		if len(vfParts) > 0 {
			fmt.Fprintf(&fc, "[%d:v]%s[v%d];", i, strings.Join(vfParts, ","), i)
		} else {
			fmt.Fprintf(&fc, "[%d:v]null[v%d];", i, i)
		}
		fmt.Fprintf(&concatV, "[v%d]", i)

		if hasAudio {
			if opts.Volume != nil {
				fmt.Fprintf(&fc, "[%d:a]volume=%f[a%d];", i, *opts.Volume, i)
			} else {
				fmt.Fprintf(&fc, "[%d:a]anull[a%d];", i, i)
			}
			fmt.Fprintf(&concatA, "[a%d]", i)
		}
	}

	if hasAudio {
		fmt.Fprintf(&fc, "%s%sconcat=n=%d:v=1:a=1[outv][outa]", concatV.String(), concatA.String(), n)
	} else {
		fmt.Fprintf(&fc, "%sconcat=n=%d:v=1:a=0[outv]", concatV.String(), n)
	}

	args = append(args, "-filter_complex", fc.String(), "-map", "[outv]")
	if hasAudio {
		args = append(args, "-map", "[outa]")
	}

	// Output video codec: explicit user choice > hw encoder > libx264.
	vCodec := "libx264"
	if opts.HWEncoder != "" {
		vCodec = opts.HWEncoder
	}
	if opts.VideoCodec != nil && *opts.VideoCodec != "" && *opts.VideoCodec != "copy" {
		vCodec = *opts.VideoCodec
	}
	args = append(args, "-c:v", vCodec)

	// Preset and quality flags differ per encoder family.
	switch vCodec {
	case "h264_nvenc", "hevc_nvenc":
		args = append(args, "-preset", "p4") // p1=fastest … p7=best quality
		if opts.CRF != nil {
			args = append(args, "-cq", fmt.Sprintf("%d", *opts.CRF))
		}
	case "h264_qsv", "hevc_qsv":
		args = append(args, "-preset", "fast")
		if opts.CRF != nil {
			args = append(args, "-global_quality", fmt.Sprintf("%d", *opts.CRF))
		}
	case "h264_videotoolbox":
		// videotoolbox doesn't support CRF; rely on bitrate or default quality.
		if opts.VideoBitrate == nil {
			args = append(args, "-b:v", "8000k")
		}
	default: // libx264, libx265
		args = append(args, "-preset", getPresetFromMode(opts.Preset, opts.PresetMode))
		if opts.CRF != nil {
			args = append(args, "-crf", fmt.Sprintf("%d", *opts.CRF))
		}
	}
	if opts.VideoBitrate != nil {
		args = append(args, "-b:v", *opts.VideoBitrate)
	}

	// Output audio codec.
	if hasAudio {
		aCodec := "aac"
		if opts.AudioCodec != nil && *opts.AudioCodec != "copy" {
			aCodec = *opts.AudioCodec
		}
		args = append(args, "-c:a", aCodec)
		if opts.AudioBitrate != nil {
			args = append(args, "-b:a", *opts.AudioBitrate)
		}
	} else {
		args = append(args, "-an")
	}

	if opts.FastStart && strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, "-y", opts.OutputPath)

	onStage("encoding")
	if err := runFFmpeg(ctx, opts.FFmpegPath, args, &totalDuration, ph); err != nil {
		return err
	}
	onStage("finalizing")
	return nil
}

// ─── Merge (multi-file, always re-encodes) ────────────────────────────────────

type mergeClipInfo struct {
	HasVideo   bool
	HasAudio   bool
	Duration   float64
	VideoCodec string
	AudioCodec string
	Resolution string
}

type MergeOptions struct {
	InputPaths  []string
	OutputPath  string
	FFmpegPath  string
	FFprobePath string
	HWEncoder   string
}

func Merge(ctx context.Context, opts MergeOptions, ph ProgressHandler) error {
	if len(opts.InputPaths) < 2 {
		return fmt.Errorf("at least 2 files required for merging")
	}

	infos := make([]*mergeClipInfo, len(opts.InputPaths))
	var targetWidth, targetHeight int
	var totalDuration float64

	for i, path := range opts.InputPaths {
		info, err := GetMediaInfo(ctx, opts.FFprobePath, path)
		if err != nil {
			return fmt.Errorf("failed to probe %s: %w", path, err)
		}
		dur := 1.0
		if info.Duration != nil && *info.Duration > 0 {
			dur = *info.Duration
		}
		infos[i] = &mergeClipInfo{
			HasVideo:   info.HasVideo,
			HasAudio:   info.HasAudio,
			Duration:   dur,
			VideoCodec: info.VideoCodec,
			AudioCodec: info.AudioCodec,
			Resolution: info.Resolution,
		}
		totalDuration += dur

		if targetWidth == 0 && info.HasVideo && info.Resolution != "" {
			parts := strings.Split(info.Resolution, "x")
			if len(parts) == 2 {
				w, _ := strconv.Atoi(parts[0])
				h, _ := strconv.Atoi(parts[1])
				targetWidth, targetHeight = w, h
			}
		}
	}
	if targetWidth == 0 {
		targetWidth, targetHeight = 1280, 720
	}

	if canFastMerge(infos) {
		return mergeStreamCopy(ctx, opts, totalDuration, ph)
	}

	args := []string{}
	for _, path := range opts.InputPaths {
		args = append(args, "-i", path)
	}
	args = append(args, "-progress", "pipe:1", "-v", "warning")

	var fc, concatInputs strings.Builder
	for i, info := range infos {
		if info.HasVideo {
			fmt.Fprintf(&fc, "[%d:v]scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1[v%d];",
				i, targetWidth, targetHeight, targetWidth, targetHeight, i)
		} else {
			fmt.Fprintf(&fc, "color=c=black:s=%dx%d:d=%.3f[v%d];", targetWidth, targetHeight, info.Duration, i)
		}
		if info.HasAudio {
			fmt.Fprintf(&fc, "[%d:a]aresample=44100:async=1[a%d];", i, i)
		} else {
			fmt.Fprintf(&fc, "aevalsrc=0:d=%.3f,aresample=44100[a%d];", info.Duration, i)
		}
		fmt.Fprintf(&concatInputs, "[v%d][a%d]", i, i)
	}
	fmt.Fprintf(&fc, "%sconcat=n=%d:v=1:a=1[outv][outa]", concatInputs.String(), len(opts.InputPaths))

	vCodec := "libx264"
	if opts.HWEncoder != "" {
		vCodec = opts.HWEncoder
	}
	args = append(args, "-filter_complex", fc.String())
	args = append(args, "-map", "[outv]", "-map", "[outa]")
	args = append(args, "-c:v", vCodec)
	switch vCodec {
	case "h264_nvenc", "hevc_nvenc":
		args = append(args, "-preset", "p4", "-cq", "25")
	case "h264_qsv", "hevc_qsv":
		args = append(args, "-preset", "fast", "-global_quality", "25")
	default:
		args = append(args, "-preset", "veryfast", "-crf", "25")
	}
	args = append(args, "-c:a", "aac", "-b:a", "128k", "-shortest", "-y", opts.OutputPath)

	return runFFmpeg(ctx, opts.FFmpegPath, args, &totalDuration, ph)
}

func canFastMerge(infos []*mergeClipInfo) bool {
	if len(infos) < 2 || infos[0] == nil {
		return false
	}

	base := infos[0]
	for _, info := range infos[1:] {
		if info == nil {
			return false
		}
		if info.HasVideo != base.HasVideo || info.HasAudio != base.HasAudio {
			return false
		}
		if info.VideoCodec != base.VideoCodec || info.AudioCodec != base.AudioCodec {
			return false
		}
		if info.HasVideo && info.Resolution != base.Resolution {
			return false
		}
	}

	return true
}

func CanFastMerge(ctx context.Context, opts MergeOptions) bool {
	if len(opts.InputPaths) < 2 {
		return false
	}

	infos := make([]*mergeClipInfo, len(opts.InputPaths))
	for i, path := range opts.InputPaths {
		info, err := GetMediaInfo(ctx, opts.FFprobePath, path)
		if err != nil {
			return false
		}
		infos[i] = &mergeClipInfo{
			HasVideo:   info.HasVideo,
			HasAudio:   info.HasAudio,
			VideoCodec: info.VideoCodec,
			AudioCodec: info.AudioCodec,
			Resolution: info.Resolution,
		}
	}

	return canFastMerge(infos)
}

func mergeStreamCopy(ctx context.Context, opts MergeOptions, totalDuration float64, ph ProgressHandler) error {
	tmpDir, err := os.MkdirTemp("", "ffm_merge_*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	listPath := filepath.Join(tmpDir, "list.txt")

	var listContent strings.Builder
	for _, inputPath := range opts.InputPaths {
		abs, err := filepath.Abs(inputPath)
		if err != nil {
			return fmt.Errorf("failed to resolve input path: %w", err)
		}
		fwd := strings.ReplaceAll(abs, "\\", "/")
		escaped := strings.ReplaceAll(fwd, "'", `'\''`)
		fmt.Fprintf(&listContent, "file '%s'\n", escaped)
	}

	if err := os.WriteFile(listPath, []byte(listContent.String()), 0644); err != nil {
		return fmt.Errorf("failed to write concat list: %w", err)
	}

	args := []string{
		"-f", "concat",
		"-safe", "0",
		"-i", listPath,
		"-c", "copy",
	}
	if strings.HasSuffix(strings.ToLower(opts.OutputPath), ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, "-progress", "pipe:1", "-v", "warning", "-y", opts.OutputPath)

	return runFFmpeg(ctx, opts.FFmpegPath, args, &totalDuration, ph)
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

// runFFmpeg starts an FFmpeg process with -progress pipe:1, drains stderr safely,
// and feeds progress events to ph. Safe to cancel via ctx.
func runFFmpeg(ctx context.Context, ffmpegPath string, args []string, totalDuration *float64, ph ProgressHandler) error {
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg start: %w", err)
	}

	// Drain stderr in background; cap at 64 KB to avoid unbounded growth.
	var errBuf bytes.Buffer
	errDone := make(chan struct{})
	go func() {
		io.Copy(&errBuf, io.LimitReader(stderr, 64*1024))
		close(errDone)
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if ph != nil && strings.HasPrefix(line, "out_time_ms=") {
			val := strings.TrimPrefix(line, "out_time_ms=")
			if ms, err := strconv.ParseFloat(val, 64); err == nil && ms >= 0 {
				if totalDuration != nil && *totalDuration > 0 {
					ph((ms/1000.0)/(*totalDuration), 1.0, ms)
				}
			}
		}
	}
	// Ignore scanner.Err() — partial reads are fine; cmd.Wait catches real failures.

	waitErr := cmd.Wait()
	<-errDone

	if waitErr != nil {
		if text := strings.TrimSpace(errBuf.String()); text != "" {
			return fmt.Errorf("ffmpeg: %w: %s", waitErr, text)
		}
		return fmt.Errorf("ffmpeg: %w", waitErr)
	}
	return nil
}

func getPreset(opts ConvertOptions) string {
	return getPresetFromMode(opts.Preset, opts.PresetMode)
}

func getPresetFromMode(preset *string, mode string) string {
	if preset != nil {
		return *preset
	}
	switch mode {
	case "low_cpu":
		return "veryfast"
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
	w, h := -1, -1
	if opts.ResizeWidth != nil {
		w = *opts.ResizeWidth
	}
	if opts.ResizeHeight != nil {
		h = *opts.ResizeHeight
	}
	if !opts.KeepAspect {
		return fmt.Sprintf("scale=%d:%d", w, h)
	}
	if opts.FitMode != nil && *opts.FitMode == "cover" && w > 0 && h > 0 {
		return fmt.Sprintf(
			"scale=iw*min(1\\,min(%d/iw\\,%d/ih)):ih*min(1\\,min(%d/iw\\,%d/ih)),pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
			w, h, w, h, w, h)
	}
	if w > 0 && h > 0 {
		return fmt.Sprintf(
			"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
			w, h, w, h)
	}
	if w > 0 {
		return fmt.Sprintf("scale=%d:-2", w)
	}
	return fmt.Sprintf("scale=-2:%d", h)
}

// Ensure hwCodecName is used; exported for potential handler use.
var _ = hwCodecName
