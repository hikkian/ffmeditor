package validator

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	AllowedInputFormats  = map[string]bool{"mp4": true, "mkv": true, "mov": true, "webm": true, "mp3": true, "aac": true, "wav": true, "flac": true, "ogg": true, "avi": true, "m4a": true}
	AllowedOutputFormats = map[string]bool{"mp4": true, "mkv": true, "mov": true, "webm": true, "mp3": true, "aac": true, "wav": true, "flac": true, "ogg": true, "m4a": true, "avi": true}
	AllowedVideoCodecs   = map[string]bool{"copy": true, "libx264": true, "libx265": true, "libvpx-vp9": true}
	AllowedAudioCodecs   = map[string]bool{"copy": true, "aac": true, "libmp3lame": true, "libopus": true, "flac": true}
	AllowedPresets       = map[string]bool{"ultrafast": true, "superfast": true, "veryfast": true, "faster": true, "fast": true, "medium": true, "slow": true, "slower": true, "veryslow": true}
	AllowedPresetModes   = map[string]bool{"low_cpu": true, "balanced": true, "quality": true}
	AllowedFitModes      = map[string]bool{"contain": true, "cover": true}
)

type ConvertRequest struct {
	FileID        string   `json:"file_id"`
	OutputFormat  string   `json:"output_format"`
	VideoCodec    *string  `json:"video_codec"`
	AudioCodec    *string  `json:"audio_codec"`
	VideoBitrate  *string  `json:"video_bitrate"`
	AudioBitrate  *string  `json:"audio_bitrate"`
	CRF           *int     `json:"crf"`
	Preset        *string  `json:"preset"`
	FPS           *int     `json:"fps"`
	RemoveAudio   bool     `json:"remove_audio"`
	RemoveVideo   bool     `json:"remove_video"`
	TrimStart     *float64 `json:"trim_start"`
	TrimDuration  *float64 `json:"trim_duration"`
	ResizeWidth   *int     `json:"resize_width"`
	ResizeHeight  *int     `json:"resize_height"`
	KeepAspect    bool     `json:"keep_aspect"`
	FitMode       *string  `json:"fit_mode"`
	FastStart     bool     `json:"fast_start"`
	StripMetadata bool     `json:"strip_metadata"`
	Brightness    *float64 `json:"brightness"`
	Contrast      *float64 `json:"contrast"`
	Volume        *float64 `json:"volume"`
}

func (r *ConvertRequest) Validate() error {
	if r.FileID == "" {
		return fmt.Errorf("file_id is required")
	}
	if r.OutputFormat == "" {
		return fmt.Errorf("output_format is required")
	}
	if !AllowedOutputFormats[strings.ToLower(r.OutputFormat)] {
		return fmt.Errorf("output_format not allowed: %s", r.OutputFormat)
	}
	if r.VideoCodec != nil && !AllowedVideoCodecs[*r.VideoCodec] {
		return fmt.Errorf("video_codec not allowed: %s", *r.VideoCodec)
	}
	if r.AudioCodec != nil && !AllowedAudioCodecs[*r.AudioCodec] {
		return fmt.Errorf("audio_codec not allowed: %s", *r.AudioCodec)
	}
	if strings.ToLower(r.OutputFormat) == "mov" && r.AudioCodec != nil && *r.AudioCodec == "libopus" {
		return fmt.Errorf("audio_codec libopus is not supported for mov; use aac")
	}
	if r.CRF != nil && (*r.CRF < 18 || *r.CRF > 35) {
		return fmt.Errorf("crf must be between 18 and 35")
	}
	if r.Preset != nil && !AllowedPresets[*r.Preset] {
		return fmt.Errorf("preset not allowed: %s", *r.Preset)
	}
	if r.FPS != nil && (*r.FPS < 1 || *r.FPS > 60) {
		return fmt.Errorf("fps must be between 1 and 60")
	}
	if r.TrimStart != nil && *r.TrimStart < 0 {
		return fmt.Errorf("trim_start cannot be negative")
	}
	if r.TrimDuration != nil && *r.TrimDuration < 0 {
		return fmt.Errorf("trim_duration cannot be negative")
	}
	if r.ResizeWidth != nil && *r.ResizeWidth < 1 {
		return fmt.Errorf("resize_width must be >= 1")
	}
	if r.ResizeHeight != nil && *r.ResizeHeight < 1 {
		return fmt.Errorf("resize_height must be >= 1")
	}
	if r.FitMode != nil && !AllowedFitModes[*r.FitMode] {
		return fmt.Errorf("fit_mode not allowed: %s", *r.FitMode)
	}
	return nil
}

// TimelineClip is one segment in an EDL-style export request.
type TimelineClip struct {
	FileID      string  `json:"file_id"`
	SourceStart float64 `json:"source_start"`
	Duration    float64 `json:"duration"`
}

// TimelineExportRequest drives POST /timeline/export.
// Mode "fast" uses stream-copy (default); "precise" forces re-encode.
type TimelineExportRequest struct {
	Clips        []TimelineClip `json:"clips"`
	OutputFormat string         `json:"output_format"`
	VideoCodec   *string        `json:"video_codec"`
	AudioCodec   *string        `json:"audio_codec"`
	VideoBitrate *string        `json:"video_bitrate"`
	AudioBitrate *string        `json:"audio_bitrate"`
	CRF          *int           `json:"crf"`
	Preset       *string        `json:"preset"`
	RemoveAudio  bool           `json:"remove_audio"`
	FastStart    bool           `json:"fast_start"`
	ResizeWidth  *int           `json:"resize_width"`
	ResizeHeight *int           `json:"resize_height"`
	KeepAspect   bool           `json:"keep_aspect"`
	Brightness   *float64       `json:"brightness"`
	Contrast     *float64       `json:"contrast"`
	Volume       *float64       `json:"volume"`
	Mode         string         `json:"mode"`
}

func (r *TimelineExportRequest) Validate() error {
	if len(r.Clips) == 0 {
		return fmt.Errorf("clips must not be empty")
	}
	if r.OutputFormat == "" {
		return fmt.Errorf("output_format is required")
	}
	if !AllowedOutputFormats[strings.ToLower(r.OutputFormat)] {
		return fmt.Errorf("output_format not allowed: %s", r.OutputFormat)
	}
	for i, clip := range r.Clips {
		if clip.FileID == "" {
			return fmt.Errorf("clip[%d].file_id is required", i)
		}
		if clip.SourceStart < 0 {
			return fmt.Errorf("clip[%d].source_start cannot be negative", i)
		}
		if clip.Duration <= 0 {
			return fmt.Errorf("clip[%d].duration must be positive", i)
		}
	}
	if r.VideoCodec != nil && !AllowedVideoCodecs[*r.VideoCodec] {
		return fmt.Errorf("video_codec not allowed: %s", *r.VideoCodec)
	}
	if r.AudioCodec != nil && !AllowedAudioCodecs[*r.AudioCodec] {
		return fmt.Errorf("audio_codec not allowed: %s", *r.AudioCodec)
	}
	if strings.ToLower(r.OutputFormat) == "mov" && r.AudioCodec != nil && *r.AudioCodec == "libopus" {
		return fmt.Errorf("audio_codec libopus is not supported for mov; use aac")
	}
	if r.Preset != nil && !AllowedPresets[*r.Preset] {
		return fmt.Errorf("preset not allowed: %s", *r.Preset)
	}
	if r.CRF != nil && (*r.CRF < 18 || *r.CRF > 35) {
		return fmt.Errorf("crf must be between 18 and 35")
	}
	if r.Mode != "" && r.Mode != "fast" && r.Mode != "precise" {
		return fmt.Errorf("mode must be 'fast' or 'precise'")
	}
	return nil
}

type MergeRequest struct {
	FileIDs      []string `json:"file_ids"`
	OutputFormat string   `json:"output_format"`
}

func (r *MergeRequest) Validate() error {
	if len(r.FileIDs) < 2 {
		return fmt.Errorf("at least 2 file_ids required for merging")
	}
	if r.OutputFormat == "" {
		return fmt.Errorf("output_format is required")
	}
	if !AllowedOutputFormats[strings.ToLower(r.OutputFormat)] {
		return fmt.Errorf("output_format not allowed: %s", r.OutputFormat)
	}
	switch strings.ToLower(r.OutputFormat) {
	case "mp3", "aac", "wav", "flac", "ogg", "m4a":
		return fmt.Errorf("merge does not support audio-only output format: %s", r.OutputFormat)
	}
	return nil
}

func SanitizeFilename(filename string) string {
	// Remove path separators and dangerous characters
	filename = strings.ReplaceAll(filename, "/", "")
	filename = strings.ReplaceAll(filename, "\\", "")
	filename = strings.ReplaceAll(filename, "..", "")

	// Only allow alphanumeric, dash, underscore, and dots
	re := regexp.MustCompile("[^a-zA-Z0-9._-]")
	filename = re.ReplaceAllString(filename, "_")

	if filename == "" {
		filename = "file"
	}
	return filename
}
