package http

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"ffmeditor/internal/config"
	"ffmeditor/internal/ffmpeg"
	"ffmeditor/internal/jobs"
	"ffmeditor/internal/metrics"
	"ffmeditor/internal/storage"
	"ffmeditor/internal/validator"
)

type Handler struct {
	cfg        *config.Config
	storage    *storage.Storage
	jobManager *jobs.Manager
}

func NewHandler(cfg *config.Config, store *storage.Storage, jm *jobs.Manager) *Handler {
	return &Handler{
		cfg:        cfg,
		storage:    store,
		jobManager: jm,
	}
}

func (h *Handler) RegisterRoutes(app *fiber.App) {
	api := app.Group("/api/v1")

	api.Post("/upload", h.Upload)
	api.Post("/convert", h.Convert)
	api.Post("/merge", h.Merge)
	api.Post("/timeline/export", h.TimelineExport)
	api.Get("/jobs/:id", h.GetJob)
	api.Delete("/jobs/:id", h.CancelJob)
	api.Get("/download/:id", h.Download)
	api.Get("/files/:id/waveform", h.GetFileWaveform)
	api.Delete("/files/:id", h.DeleteFile)
	api.Get("/metrics/system/current", h.MetricsSystem)
	api.Get("/health", h.Health)
}

// Upload handles multipart file uploads
func (h *Handler) Upload(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "No file uploaded",
		})
	}

	// Check file size
	if file.Size > int64(h.cfg.MaxUploadMB)*1024*1024 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("File too large (max %d MB)", h.cfg.MaxUploadMB),
		})
	}

	// Generate ID and sanitize name
	fileID := uuid.New().String()
	originalName := validator.SanitizeFilename(file.Filename)
	ext := strings.ToLower(filepath.Ext(originalName))
	if ext != "" {
		ext = ext[1:] // Remove the dot
	}

	if ext == "" {
		ext = "bin"
	}

	if !validator.AllowedInputFormats[ext] {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Format not allowed",
		})
	}

	// Save file
	storagePath := h.storage.GetStoragePath(fileID, ext)
	src, err := file.Open()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read file",
		})
	}
	defer src.Close()

	dst, err := os.Create(storagePath)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to copy file",
		})
	}

	// Probe for media info
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var mediaInfo *storage.MediaInfo
	if fullInfo, err := ffmpeg.GetMediaInfo(ctx, h.cfg.FFprobePath, storagePath); err == nil {
		duration := 0.0
		if fullInfo.Duration != nil {
			duration = *fullInfo.Duration
		}
		mediaInfo = &storage.MediaInfo{
			Duration:   &duration,
			VideoCodec: fullInfo.VideoCodec,
			AudioCodec: fullInfo.AudioCodec,
			HasVideo:   fullInfo.HasVideo,
			HasAudio:   fullInfo.HasAudio,
		}
	} else {
		mediaInfo = &storage.MediaInfo{}
	}

	uf := &storage.UploadedFile{
		ID:           fileID,
		OriginalName: originalName,
		StoragePath:  storagePath,
		MediaInfo:    mediaInfo,
		UploadedAt:   time.Now(),
	}

	h.storage.Store(uf)

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"file_id":       fileID,
		"original_name": originalName,
		"media_info": fiber.Map{
			"duration":    mediaInfo.Duration,
			"has_video":   mediaInfo.HasVideo,
			"has_audio":   mediaInfo.HasAudio,
			"video_codec": mediaInfo.VideoCodec,
			"audio_codec": mediaInfo.AudioCodec,
		},
	})
}

// Convert starts a conversion job
func (h *Handler) Convert(c *fiber.Ctx) error {
	var req validator.ConvertRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if err := req.Validate(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Check if file exists
	uf := h.storage.Get(req.FileID)
	if uf == nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "File not found",
		})
	}

	// Create job
	job := h.jobManager.CreateJob(req.FileID, uf.OriginalName, req.OutputFormat)

	reqCopy := req
	if err := h.jobManager.Enqueue(job, func() {
		h.performConvert(job, uf, &reqCopy)
	}); err != nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"job_id": job.ID,
		"status": job.Status,
	})
}

func (h *Handler) performConvert(job *jobs.Job, uf *storage.UploadedFile, req *validator.ConvertRequest) {
	h.jobManager.AddLog(job.ID, "Starting conversion...")

	// Generate output filename
	outputName := fmt.Sprintf("%s_converted.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)

	// Set up convert options
	opts := ffmpeg.ConvertOptions{
		InputPath:     uf.StoragePath,
		OutputPath:    outputPath,
		FFmpegPath:    h.cfg.FFmpegPath,
		FFprobePath:   h.cfg.FFprobePath,
		VideoCodec:    req.VideoCodec,
		AudioCodec:    req.AudioCodec,
		VideoBitrate:  req.VideoBitrate,
		AudioBitrate:  req.AudioBitrate,
		CRF:           req.CRF,
		Preset:        req.Preset,
		FPS:           req.FPS,
		RemoveAudio:   req.RemoveAudio,
		RemoveVideo:   req.RemoveVideo,
		TrimStart:     req.TrimStart,
		TrimDuration:  req.TrimDuration,
		ResizeWidth:   req.ResizeWidth,
		ResizeHeight:  req.ResizeHeight,
		KeepAspect:    req.KeepAspect,
		FitMode:       req.FitMode,
		FastStart:     req.FastStart,
		StripMetadata: req.StripMetadata,
		PresetMode:    h.cfg.PresetMode,
		Brightness:    req.Brightness,
		Contrast:      req.Contrast,
		Volume:        req.Volume,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	// Progress handler
	progressHandler := func(current, total, outTimeMs float64) {
		h.jobManager.SetProgress(job.ID, current, outTimeMs)
	}

	if err := ffmpeg.Convert(ctx, opts, progressHandler); err != nil {
		h.jobManager.AddLog(job.ID, fmt.Sprintf("Error: %v", err))
		h.jobManager.SetError(job.ID, err.Error())
		return
	}

	h.jobManager.AddLog(job.ID, "Conversion completed successfully")
	h.jobManager.SetCompleted(job.ID, outputName)
}

// Merge starts a merge job
func (h *Handler) Merge(c *fiber.Ctx) error {
	var req validator.MergeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if err := req.Validate(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	var inputPaths []string
	var duration float64
	for _, id := range req.FileIDs {
		uf := h.storage.Get(id)
		if uf == nil {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("File %s not found", id),
			})
		}
		inputPaths = append(inputPaths, uf.StoragePath)
		if uf.MediaInfo != nil && uf.MediaInfo.Duration != nil {
			duration += *uf.MediaInfo.Duration
		}
	}

	// Create job using the first file's ID as anchor
	job := h.jobManager.CreateJob(req.FileIDs[0], "Merged_Video", req.OutputFormat)

	reqCopy := req
	if err := h.jobManager.Enqueue(job, func() {
		h.performMerge(job, inputPaths, duration, &reqCopy)
	}); err != nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"job_id": job.ID,
		"status": job.Status,
	})
}

func (h *Handler) performMerge(job *jobs.Job, inputPaths []string, totalDuration float64, req *validator.MergeRequest) {
	start := time.Now()
	h.jobManager.AddLog(job.ID, "Starting merge...")

	outputName := fmt.Sprintf("%s_merged.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)

	opts := ffmpeg.MergeOptions{
		InputPaths:  inputPaths,
		OutputPath:  outputPath,
		FFmpegPath:  h.cfg.FFmpegPath,
		FFprobePath: h.cfg.FFprobePath,
		HWEncoder:   h.cfg.ResolvedHWEncoder,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	h.jobManager.SetCancelFunc(job.ID, cancel)

	strategy := "reencode"
	if ffmpeg.CanFastMerge(ctx, opts) {
		strategy = "stream_copy"
	}
	h.jobManager.SetStrategy(job.ID, strategy)
	h.jobManager.SetStage(job.ID, "preparing merge")
	h.jobManager.AddLog(job.ID, fmt.Sprintf("Strategy: %s (%d files)", strategy, len(inputPaths)))

	progressHandler := func(current, total, outTimeMs float64) {
		if totalDuration > 0 {
			pct := (outTimeMs / 1000.0) / totalDuration
			h.jobManager.SetProgress(job.ID, pct, outTimeMs)
		}
	}

	if err := ffmpeg.Merge(ctx, opts, progressHandler); err != nil {
		h.jobManager.AddLog(job.ID, fmt.Sprintf("Error: %v", err))
		h.jobManager.SetError(job.ID, err.Error())
		return
	}

	h.jobManager.SetStage(job.ID, "done")
	h.jobManager.AddLog(job.ID, fmt.Sprintf("Completed in %.1fs (strategy: %s)", time.Since(start).Seconds(), strategy))
	h.jobManager.AddLog(job.ID, "Merge completed successfully")
	h.jobManager.SetCompleted(job.ID, outputName)
}

// GetJob returns job details
func (h *Handler) GetJob(c *fiber.Ctx) error {
	jobID := c.Params("id")
	job := h.jobManager.GetJob(jobID)
	if job == nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Job not found",
		})
	}

	return c.Status(http.StatusOK).JSON(job)
}

// Download streams the output file
func (h *Handler) Download(c *fiber.Ctx) error {
	jobID := c.Params("id")
	job := h.jobManager.GetJob(jobID)
	if job == nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Job not found",
		})
	}

	if job.Status != jobs.StatusCompleted {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Job not completed",
		})
	}

	outputPath := filepath.Join(h.cfg.OutputDir, job.OutputFilename)
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Output file not found",
		})
	}

	return c.Download(outputPath, job.OutputFilename)
}

func (h *Handler) GetFileWaveform(c *fiber.Ctx) error {
	fileID := c.Params("id")
	uf := h.storage.Get(fileID)
	if uf == nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "File not found",
		})
	}

	bars := c.QueryInt("bars", 160)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	waveform, err := ffmpeg.GenerateWaveform(ctx, h.cfg.FFmpegPath, uf.StoragePath, bars)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"file_id": fileID,
		"bars":    waveform,
	})
}

// TimelineExport starts an EDL-based export job.
func (h *Handler) TimelineExport(c *fiber.Ctx) error {
	var req validator.TimelineExportRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if err := req.Validate(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	// Resolve file IDs → storage paths and populate HasVideo/HasAudio.
	clips := make([]ffmpeg.TimelineExportClip, 0, len(req.Clips))
	for _, rc := range req.Clips {
		uf := h.storage.Get(rc.FileID)
		if uf == nil {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("file %s not found", rc.FileID),
			})
		}
		hasVideo, hasAudio := true, true
		if uf.MediaInfo != nil {
			hasVideo = uf.MediaInfo.HasVideo
			hasAudio = uf.MediaInfo.HasAudio
		}
		clips = append(clips, ffmpeg.TimelineExportClip{
			FileID:      rc.FileID,
			FilePath:    uf.StoragePath,
			SourceStart: rc.SourceStart,
			Duration:    rc.Duration,
			HasVideo:    hasVideo,
			HasAudio:    hasAudio,
		})
	}

	firstUF := h.storage.Get(req.Clips[0].FileID)
	job := h.jobManager.CreateJob(req.Clips[0].FileID, firstUF.OriginalName, req.OutputFormat)

	reqCopy := req
	clipsCopy := clips
	if err := h.jobManager.Enqueue(job, func() {
		h.performTimelineExport(job, clipsCopy, &reqCopy)
	}); err != nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"job_id": job.ID,
		"status": job.Status,
	})
}

func (h *Handler) performTimelineExport(job *jobs.Job, clips []ffmpeg.TimelineExportClip, req *validator.TimelineExportRequest) {
	start := time.Now()
	h.jobManager.AddLog(job.ID, "Timeline export started")

	outputName := fmt.Sprintf("%s_export.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)

	opts := ffmpeg.TimelineExportOptions{
		Clips:        clips,
		OutputPath:   outputPath,
		FFmpegPath:   h.cfg.FFmpegPath,
		FFprobePath:  h.cfg.FFprobePath,
		VideoCodec:   req.VideoCodec,
		AudioCodec:   req.AudioCodec,
		VideoBitrate: req.VideoBitrate,
		AudioBitrate: req.AudioBitrate,
		CRF:          req.CRF,
		Preset:       req.Preset,
		RemoveAudio:  req.RemoveAudio,
		FastStart:    req.FastStart,
		ResizeWidth:  req.ResizeWidth,
		ResizeHeight: req.ResizeHeight,
		KeepAspect:   req.KeepAspect,
		Brightness:   req.Brightness,
		Contrast:     req.Contrast,
		Volume:       req.Volume,
		PresetMode:   h.cfg.PresetMode,
		Mode:         req.Mode,
		HWEncoder:    h.cfg.ResolvedHWEncoder,
	}

	strategy := "stream_copy"
	if !ffmpeg.CanStreamCopy(opts) {
		strategy = "reencode"
	}
	h.jobManager.SetStrategy(job.ID, strategy)
	h.jobManager.AddLog(job.ID, fmt.Sprintf("Strategy: %s (%d clips)", strategy, len(clips)))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	h.jobManager.SetCancelFunc(job.ID, cancel)

	progressHandler := func(current, _, outTimeMs float64) {
		h.jobManager.SetProgress(job.ID, current, outTimeMs)
	}
	stageHandler := func(stage string) {
		h.jobManager.SetStage(job.ID, stage)
		h.jobManager.AddLog(job.ID, "→ "+stage)
	}

	if err := ffmpeg.TimelineExport(ctx, opts, progressHandler, stageHandler); err != nil {
		h.jobManager.AddLog(job.ID, "Error: "+err.Error())
		h.jobManager.SetError(job.ID, err.Error())
		return
	}

	elapsed := time.Since(start).Seconds()
	h.jobManager.AddLog(job.ID, fmt.Sprintf("Completed in %.1fs (strategy: %s)", elapsed, strategy))
	h.jobManager.SetCompleted(job.ID, outputName)
}

// CancelJob aborts a running job.
func (h *Handler) CancelJob(c *fiber.Ctx) error {
	jobID := c.Params("id")
	if ok := h.jobManager.Cancel(jobID); !ok {
		job := h.jobManager.GetJob(jobID)
		if job == nil {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "job not found"})
		}
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("job cannot be canceled (status: %s)", job.Status),
		})
	}
	return c.Status(http.StatusOK).JSON(fiber.Map{"canceled": true})
}

// MetricsSystem returns a cached system snapshot (CPU, RAM, GPU).
func (h *Handler) MetricsSystem(c *fiber.Ctx) error {
	return c.Status(http.StatusOK).JSON(metrics.Current())
}

// Health returns server health status
func (h *Handler) Health(c *fiber.Ctx) error {
	return c.Status(http.StatusOK).JSON(fiber.Map{
		"status": "ok",
	})
}

// DeleteFile removes a file from storage and disk
func (h *Handler) DeleteFile(c *fiber.Ctx) error {
	fileID := c.Params("id")
	uf := h.storage.Get(fileID)
	if uf == nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "File not found",
		})
	}

	// Delete from disk
	os.Remove(uf.StoragePath)

	// Remove from storage
	h.storage.Delete(fileID)

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"success": true,
	})
}
