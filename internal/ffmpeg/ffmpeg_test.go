package ffmpeg_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"ffmeditor/internal/ffmpeg"
)

func testData(name string) string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "tests", name)
}

func bin() (string, string) { return "ffmpeg", "ffprobe" }

func mkctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 2*time.Minute)
}

func pstr(v string) *string  { return &v }
func pint(v int) *int        { return &v }
func pf64(v float64) *float64 { return &v }

func assertOutput(t *testing.T, path string) {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil || fi.Size() == 0 {
		t.Fatalf("output missing or empty: %s", path)
	}
}

// ─── MediaInfo ────────────────────────────────────────────────────────────────

func TestGetMediaInfo(t *testing.T) {
	ff, fp := bin()
	c, cancel := mkctx(); defer cancel()
	info, err := ffmpeg.GetMediaInfo(c, fp, testData("v1.mp4"))
	if err != nil {
		t.Fatalf("GetMediaInfo: %v", err)
	}
	if !info.HasVideo {
		t.Error("expected HasVideo")
	}
	if info.Duration == nil || *info.Duration <= 0 {
		t.Error("expected positive duration")
	}
	_ = ff
}

// ─── Convert: formats ─────────────────────────────────────────────────────────

func convertBase(in, out string) ffmpeg.ConvertOptions {
	ff, fp := bin()
	return ffmpeg.ConvertOptions{
		InputPath: in, OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		TrimDuration: pf64(3.0),
	}
}

func TestConvert_MP4_x264(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.mp4")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.VideoCodec, o.AudioCodec, o.CRF = pstr("libx264"), pstr("aac"), pint(28)
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_MP4_x265(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.mp4")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.VideoCodec, o.AudioCodec, o.CRF = pstr("libx265"), pstr("aac"), pint(28)
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_MKV_vp9_opus(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.mkv")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.VideoCodec, o.AudioCodec = pstr("libvpx-vp9"), pstr("libopus")
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_WebM_vp9(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.webm")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.VideoCodec, o.AudioCodec = pstr("libvpx-vp9"), pstr("libopus")
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_AVI_x264(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.avi")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.VideoCodec, o.AudioCodec, o.CRF = pstr("libx264"), pstr("aac"), pint(28)
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

// ─── Convert: audio-only formats ─────────────────────────────────────────────

func TestConvert_MP3(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.mp3")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.RemoveVideo = true
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_AAC_M4A(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.m4a")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.RemoveVideo = true
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_WAV(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.wav")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.RemoveVideo = true
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_FLAC(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.flac")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.RemoveVideo = true
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_OGG(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out.ogg")
	c, cancel := mkctx(); defer cancel()
	o := convertBase(testData("v1.mp4"), out)
	o.RemoveVideo = true
	if err := ffmpeg.Convert(c, o, nil); err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

// ─── Convert: editing features ────────────────────────────────────────────────

func TestConvert_Trim(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "trim.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		TrimStart: pf64(0.5), TrimDuration: pf64(2.0),
		VideoCodec: pstr("libx264"), CRF: pint(28),
	}, nil)
	if err != nil { t.Fatal(err) }
	c2, cancel2 := mkctx(); defer cancel2()
	info, _ := ffmpeg.GetMediaInfo(c2, fp, out)
	if info.Duration == nil || *info.Duration > 3.0 {
		t.Errorf("expected ~2s, got %v", info.Duration)
	}
}

func TestConvert_Resize480p(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "480p.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		ResizeWidth: pint(854), ResizeHeight: pint(480), KeepAspect: true,
		VideoCodec: pstr("libx264"), CRF: pint(28), TrimDuration: pf64(2.0),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_Resize360p_WidthOnly(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "360p.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		ResizeWidth: pint(640), KeepAspect: true,
		VideoCodec: pstr("libx264"), CRF: pint(28), TrimDuration: pf64(2.0),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_AudioEffects(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "effects.mp3")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		RemoveVideo: true, TrimDuration: pf64(3.0),
		Volume: pf64(1.5), Speed: pf64(1.25), Normalize: true,
		FadeIn: pf64(0.3), FadeOut: pf64(0.3),
		Bass: pf64(2.0), Treble: pf64(-1.5),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_Speed_Half(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "slow.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		TrimDuration: pf64(2.0), Speed: pf64(0.5),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_Speed_Double(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "fast.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		TrimDuration: pf64(2.0), Speed: pf64(2.0),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_Speed_4x(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "4x.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		TrimDuration: pf64(2.0), Speed: pf64(4.0),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_RemoveAudio(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "noaudio.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		RemoveAudio: true, TrimDuration: pf64(2.0),
	}, nil)
	if err != nil { t.Fatal(err) }
	c2, cancel2 := mkctx(); defer cancel2()
	info, _ := ffmpeg.GetMediaInfo(c2, fp, out)
	if info.HasAudio {
		t.Error("expected no audio stream")
	}
}

func TestConvert_BrightnessContrast(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "eq.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		TrimDuration: pf64(2.0),
		Brightness: pf64(0.15), Contrast: pf64(1.3),
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_FastStartStripMeta(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "opts.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: out,
		FFmpegPath: ff, FFprobePath: fp,
		VideoCodec: pstr("libx264"), CRF: pint(28),
		TrimDuration: pf64(2.0),
		FastStart: true, StripMetadata: true,
	}, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestConvert_CRF_Range(t *testing.T) {
	ff, fp := bin()
	for _, crf := range []int{18, 23, 35} {
		crf := crf
		t.Run("", func(t *testing.T) {
			t.Parallel()
			out := filepath.Join(t.TempDir(), "crf.mp4")
			c, cancel := mkctx(); defer cancel()
			err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
				InputPath: testData("v1.mp4"), OutputPath: out,
				FFmpegPath: ff, FFprobePath: fp,
				VideoCodec: pstr("libx264"), CRF: &crf,
				TrimDuration: pf64(2.0),
			}, nil)
			if err != nil { t.Fatalf("crf=%d: %v", crf, err) }
		})
	}
}

// ─── Merge ────────────────────────────────────────────────────────────────────

func TestMerge_TwoFiles(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "merged.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Merge(c, ffmpeg.MergeOptions{
		InputPaths:  []string{testData("v1.mp4"), testData("v2.mp4")},
		OutputPath:  out,
		FFmpegPath:  ff,
		FFprobePath: fp,
	}, nil)
	if err != nil { t.Fatal(err) }
	c2, cancel2 := mkctx(); defer cancel2()
	info, _ := ffmpeg.GetMediaInfo(c2, fp, out)
	if info.Duration == nil || *info.Duration <= 0 {
		t.Error("merged output has no duration")
	}
}

func TestCanFastMerge(t *testing.T) {
	ff, fp := bin()
	c, cancel := mkctx(); defer cancel()
	result := ffmpeg.CanFastMerge(c, ffmpeg.MergeOptions{
		InputPaths:  []string{testData("v1.mp4"), testData("v2.mp4")},
		FFmpegPath:  ff,
		FFprobePath: fp,
	})
	// Just check it doesn't panic; v1+v2 may or may not be fast-merge compatible
	_ = result
}

// ─── Timeline Export ──────────────────────────────────────────────────────────

func mkClip(path string, start, dur float64) ffmpeg.TimelineExportClip {
	return ffmpeg.TimelineExportClip{
		FilePath: path, SourceStart: start, Duration: dur,
		HasVideo: true, HasAudio: true,
	}
}

func TestTimeline_Fast_Single(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "out.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 3)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp, Mode: "fast",
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_Fast_Multi(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "out.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{
			mkClip(testData("v1.mp4"), 0, 2),
			mkClip(testData("v1.mp4"), 2, 2),
		},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp, Mode: "fast",
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_Precise_Resize(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "precise.mp4")
	c, cancel := mkctx(); defer cancel()
	w, h := 640, 360
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 2)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
		Mode: "precise", VideoCodec: pstr("libx264"), CRF: pint(28),
		ResizeWidth: &w, ResizeHeight: &h, KeepAspect: true,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_Precise_Multi_Effects(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "effects.mp4")
	c, cancel := mkctx(); defer cancel()
	vol, fi, fo := 1.2, 0.2, 0.2
	// Use v1.mp4 twice since v2.mp4 has no audio
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{
			mkClip(testData("v1.mp4"), 0, 2),
			mkClip(testData("v1.mp4"), 2, 2),
		},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
		Mode: "precise", VideoCodec: pstr("libx264"), CRF: pint(28),
		Volume: &vol, FadeIn: &fi, FadeOut: &fo, Normalize: true,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_AudioOnly_FLAC(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "audio.flac")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 3)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_AudioOnly_MP3(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "audio.mp3")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 3)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_AudioOnly_WAV(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "audio.wav")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 3)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_AudioOnly_OGG(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "audio.ogg")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 3)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_AudioOnly_MultiClip_MP3(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "multi.mp3")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{
			mkClip(testData("v1.mp4"), 0, 2),
			mkClip(testData("v1.mp4"), 2, 2),
		},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	assertOutput(t, out)
}

func TestTimeline_RemoveAudio(t *testing.T) {
	ff, fp := bin()
	out := filepath.Join(t.TempDir(), "noaudio.mp4")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.TimelineExport(c, ffmpeg.TimelineExportOptions{
		Clips: []ffmpeg.TimelineExportClip{mkClip(testData("v1.mp4"), 0, 2)},
		OutputPath: out, FFmpegPath: ff, FFprobePath: fp,
		Mode: "fast", RemoveAudio: true,
	}, nil, nil)
	if err != nil { t.Fatal(err) }
	c2, cancel2 := mkctx(); defer cancel2()
	info, _ := ffmpeg.GetMediaInfo(c2, fp, out)
	if info.HasAudio {
		t.Error("expected no audio")
	}
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

func TestGenerateWaveform(t *testing.T) {
	ff, _ := bin()
	c, cancel := mkctx(); defer cancel()
	bars, err := ffmpeg.GenerateWaveform(c, ff, testData("v1.mp4"), 80)
	if err != nil { t.Fatal(err) }
	if len(bars) == 0 {
		t.Error("expected waveform bars")
	}
}

func TestGenerateWaveform_AudioOnly(t *testing.T) {
	ff, fp := bin()
	// Create an MP3 first, then generate waveform from it
	mp3 := filepath.Join(t.TempDir(), "audio.mp3")
	c, cancel := mkctx(); defer cancel()
	err := ffmpeg.Convert(c, ffmpeg.ConvertOptions{
		InputPath: testData("v1.mp4"), OutputPath: mp3,
		FFmpegPath: ff, FFprobePath: fp,
		RemoveVideo: true, TrimDuration: pf64(3.0),
	}, nil)
	if err != nil { t.Fatalf("create mp3: %v", err) }

	c2, cancel2 := mkctx(); defer cancel2()
	bars, err := ffmpeg.GenerateWaveform(c2, ff, mp3, 60)
	if err != nil { t.Fatalf("waveform: %v", err) }
	if len(bars) == 0 {
		t.Error("expected waveform bars from mp3")
	}
}
