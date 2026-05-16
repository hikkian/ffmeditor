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
	"ffmeditor/internal/models"
	"ffmeditor/internal/storage"
	"ffmeditor/internal/validator"
)

type Handler struct {
	cfg        *config.Config
	storage    *storage.Storage
	jobManager *jobs.Manager
	collector  *metrics.Collector
	metStore   *metrics.Store
}

func NewHandler(cfg *config.Config, store *storage.Storage, jm *jobs.Manager, col *metrics.Collector, ms *metrics.Store) *Handler {
	return &Handler{
		cfg:        cfg,
		storage:    store,
		jobManager: jm,
		collector:  col,
		metStore:   ms,
	}
}

func (h *Handler) RegisterRoutes(app *fiber.App) {
	api := app.Group("/api/v1")

	api.Post("/upload", h.Upload)
	api.Post("/convert", h.Convert)
	api.Post("/merge", h.Merge)
	api.Post("/timeline/export", h.ExportTimeline)
	api.Get("/jobs/:id", h.GetJob)
	api.Delete("/jobs/:id", h.CancelJob)
	api.Get("/download/:id", h.Download)
	api.Delete("/files/:id", h.DeleteFile)
	api.Get("/health", h.Health)

	// Metrics endpoints
	api.Get("/metrics/system/current", h.MetricsSystemCurrent)
	api.Get("/metrics/operations", h.MetricsOperations)
	api.Get("/metrics/summary", h.MetricsSummary)
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
		os.Remove(storagePath) // Cleanup partial file
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to copy file",
		})
	}

	// Probe for media info
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var mediaInfo *models.MediaInfo
	if fullInfo, err := ffmpeg.GetMediaInfo(ctx, h.cfg.FFprobePath, storagePath); err == nil {
		duration := 0.0
		if fullInfo.Duration != nil {
			duration = *fullInfo.Duration
		}
		mediaInfo = &models.MediaInfo{
			Duration:   &duration,
			VideoCodec: fullInfo.VideoCodec,
			AudioCodec: fullInfo.AudioCodec,
			HasVideo:   fullInfo.HasVideo,
			HasAudio:   fullInfo.HasAudio,
			Resolution: fullInfo.Resolution,
		}
	} else {
		mediaInfo = &models.MediaInfo{}
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
			"resolution":  mediaInfo.Resolution,
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
	if err := h.jobManager.Enqueue(job, func(ctx context.Context) {
		h.performConvert(ctx, job, uf, &reqCopy)
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

func (h *Handler) performConvert(ctx context.Context, job *jobs.Job, uf *storage.UploadedFile, req *validator.ConvertRequest) {
	h.jobManager.AddLog(job.ID, "Starting conversion...")

	outputName := fmt.Sprintf("%s_converted.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)

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

	progressHandler := func(current, total, outTimeMs float64) {
		h.jobManager.SetProgress(job.ID, current, outTimeMs)
	}

	opStart := time.Now()
	ffmpegMet := &ffmpeg.FFmpegMetrics{}
	convertErr := ffmpeg.Convert(ctx, opts, progressHandler, ffmpegMet)
	elapsed := time.Since(opStart).Seconds()

	// Record metrics regardless of success/failure.
	h.recordOperation(job.ID, "convert", uf, outputPath, req.OutputFormat, elapsed, ffmpegMet, opStart, convertErr,
		codecStr(req.VideoCodec), codecStr(req.AudioCodec))

	if convertErr != nil {
		h.jobManager.AddLog(job.ID, fmt.Sprintf("Error: %v", convertErr))
		h.jobManager.SetError(job.ID, convertErr.Error())
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
	if err := h.jobManager.Enqueue(job, func(ctx context.Context) {
		h.performMerge(ctx, job, inputPaths, duration, &reqCopy)
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

func (h *Handler) performMerge(ctx context.Context, job *jobs.Job, inputPaths []string, totalDuration float64, req *validator.MergeRequest) {
	h.jobManager.AddLog(job.ID, "Starting merge...")

	outputName := fmt.Sprintf("%s_merged.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)

	opts := ffmpeg.MergeOptions{
		InputPaths:  inputPaths,
		OutputPath:  outputPath,
		FFmpegPath:  h.cfg.FFmpegPath,
		FFprobePath: h.cfg.FFprobePath,
	}

	progressHandler := func(current, total, outTimeMs float64) {
		if totalDuration > 0 {
			pct := (outTimeMs / 1000.0) / totalDuration
			h.jobManager.SetProgress(job.ID, pct, outTimeMs)
		}
	}

	opStart := time.Now()
	ffmpegMet := &ffmpeg.FFmpegMetrics{}
	mergeErr := ffmpeg.Merge(ctx, opts, progressHandler, ffmpegMet)
	elapsed := time.Since(opStart).Seconds()

	// Synthesize a fake UploadedFile for metrics (no single source file).
	fakeUF := &storage.UploadedFile{
		OriginalName: "merged",
		MediaInfo:    &models.MediaInfo{Duration: &totalDuration},
	}
	h.recordOperation(job.ID, "merge", fakeUF, outputPath, req.OutputFormat, elapsed, ffmpegMet, opStart, mergeErr, "", "")

	if mergeErr != nil {
		h.jobManager.AddLog(job.ID, fmt.Sprintf("Error: %v", mergeErr))
		h.jobManager.SetError(job.ID, mergeErr.Error())
		return
	}

	h.jobManager.AddLog(job.ID, "Merge completed successfully")
	h.jobManager.SetCompleted(job.ID, outputName)
}

// ExportTimeline starts a timeline export job with multiple clips.
func (h *Handler) ExportTimeline(c *fiber.Ctx) error {
	var req validator.TimelineExportRequest
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

	clipInputs := make([]ffmpeg.TimelineClipInput, 0, len(req.Clips))
	var firstClipOriginalName string
	var targetWidth, targetHeight int
	for _, clip := range req.Clips {
		uf := h.storage.Get(clip.FileID)
		if uf == nil {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("File %s not found", clip.FileID),
			})
		}
		if firstClipOriginalName == "" {
			firstClipOriginalName = uf.OriginalName
		}

		if targetWidth == 0 || targetHeight == 0 {
			targetWidth, targetHeight = resolveTimelineTargetSize(uf.MediaInfo)
		}

		clipInputs = append(clipInputs, ffmpeg.TimelineClipInput{
			InputPath:   uf.StoragePath,
			SourceStart: clip.SourceStart,
			Duration:    clip.Duration,
			HasVideo:    uf.MediaInfo != nil && uf.MediaInfo.HasVideo,
			HasAudio:    uf.MediaInfo != nil && uf.MediaInfo.HasAudio,
		})
	}

	if targetWidth == 0 || targetHeight == 0 {
		targetWidth = 1280
		targetHeight = 720
	}

	job := h.jobManager.CreateJob(req.Clips[0].FileID, firstClipOriginalName, req.OutputFormat)
	reqCopy := req
	clipInputsCopy := append([]ffmpeg.TimelineClipInput(nil), clipInputs...)

	if err := h.jobManager.Enqueue(job, func(ctx context.Context) {
		h.performTimelineExport(ctx, job, clipInputsCopy, targetWidth, targetHeight, &reqCopy)
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

func (h *Handler) performTimelineExport(ctx context.Context, job *jobs.Job, clips []ffmpeg.TimelineClipInput, targetWidth, targetHeight int, req *validator.TimelineExportRequest) {
	h.jobManager.AddLog(job.ID, "Starting timeline export...")

	outputName := fmt.Sprintf("%s_timeline.%s", job.ID[:8], req.OutputFormat)
	outputPath := filepath.Join(h.cfg.OutputDir, outputName)
	h.jobManager.SetOutputPath(job.ID, outputPath)


	opts := ffmpeg.TimelineExportOptions{
		Clips:         clips,
		OutputPath:    outputPath,
		OutputFormat:  req.OutputFormat,
		FFmpegPath:    h.cfg.FFmpegPath,
		FFprobePath:   h.cfg.FFprobePath,
		TargetWidth:   targetWidth,
		TargetHeight:  targetHeight,
		VideoCodec:    req.VideoCodec,
		AudioCodec:    req.AudioCodec,
		VideoBitrate:  req.VideoBitrate,
		AudioBitrate:  req.AudioBitrate,
		CRF:           req.CRF,
		Preset:        req.Preset,
		FPS:           req.FPS,
		RemoveAudio:   req.RemoveAudio,
		ResizeWidth:   req.ResizeWidth,
		ResizeHeight:  req.ResizeHeight,
		KeepAspect:    req.KeepAspect,
		FitMode:       req.FitMode,
		FastStart:     req.FastStart,
		StripMetadata: req.StripMetadata,
		Brightness:    req.Brightness,
		Contrast:      req.Contrast,
		Volume:        req.Volume,
	}

	progressHandler := func(current, total, outTimeMs float64) {
		h.jobManager.SetProgress(job.ID, current, outTimeMs)
	}

	opStart := time.Now()
	ffmpegMet := &ffmpeg.FFmpegMetrics{}
	tlErr := ffmpeg.ExportTimeline(ctx, opts, progressHandler, ffmpegMet)
	elapsed := time.Since(opStart).Seconds()

	// Compute total duration from clips for metrics.
	var tlDuration float64
	for _, clip := range clips {
		tlDuration += clip.Duration
	}
	fakeUF := &storage.UploadedFile{
		OriginalName: "timeline",
		MediaInfo:    &models.MediaInfo{Duration: &tlDuration},
	}
	h.recordOperation(job.ID, "timeline", fakeUF, outputPath, req.OutputFormat, elapsed, ffmpegMet, opStart, tlErr,
		codecStr(req.VideoCodec), codecStr(req.AudioCodec))

	if tlErr != nil {
		h.jobManager.AddLog(job.ID, fmt.Sprintf("Error: %v", tlErr))
		h.jobManager.SetError(job.ID, tlErr.Error())
		return
	}

	h.jobManager.AddLog(job.ID, "Timeline export completed successfully")
	h.jobManager.SetCompleted(job.ID, outputName)
}

// CancelJob cancels an active job
func (h *Handler) CancelJob(c *fiber.Ctx) error {
	jobID := c.Params("id")
	if err := h.jobManager.CancelJob(jobID); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}
	return c.Status(http.StatusOK).JSON(fiber.Map{
		"message": "job canceled",
	})
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

// ─── Metrics helpers ──────────────────────────────────────────────────────────

// recordOperation gathers system/FFmpeg metrics and writes a record to the store.
func (h *Handler) recordOperation(
	jobID, opType string,
	uf *storage.UploadedFile,
	outputPath, outputFormat string,
	elapsed float64,
	ffmpegMet *ffmpeg.FFmpegMetrics,
	opStart time.Time,
	opErr error,
	videoCodec, audioCodec string,
) {
	if h.collector == nil || h.metStore == nil {
		return
	}
	pm := h.collector.PeriodBetween(opStart, time.Now())

	var inputSizeMB, inputDuration float64
	var inputFile string
	if uf != nil {
		if info, err := os.Stat(uf.StoragePath); err == nil {
			inputSizeMB = float64(info.Size()) / (1024 * 1024)
		}
		inputFile = uf.OriginalName
		if uf.MediaInfo != nil && uf.MediaInfo.Duration != nil {
			inputDuration = *uf.MediaInfo.Duration
		}
	}

	var outputSizeMB float64
	if info, err := os.Stat(outputPath); err == nil {
		outputSizeMB = float64(info.Size()) / (1024 * 1024)
	}

	speedRatio := 0.0
	if elapsed > 0 && inputDuration > 0 {
		speedRatio = inputDuration / elapsed
	}

	errMsg := ""
	if opErr != nil {
		errMsg = opErr.Error()
		if len(errMsg) > 200 {
			errMsg = errMsg[:200]
		}
	}

	rec := metrics.OperationRecord{
		ID:                uuid.New().String(),
		JobID:             jobID,
		Timestamp:         opStart,
		Operation:         opType,
		InputFile:         inputFile,
		InputSizeMB:       inputSizeMB,
		InputDurationSec:  inputDuration,
		OutputSizeMB:      outputSizeMB,
		ProcessingTimeSec: elapsed,
		SpeedRatio:        speedRatio,
		AvgCPUPercent:     pm.AvgCPU,
		PeakCPUPercent:    pm.PeakCPU,
		AvgRAMMB:          pm.AvgRAM,
		PeakRAMMB:         pm.PeakRAM,
		GPUAvailable:      pm.GPUAvail,
		AvgGPUPercent:     pm.AvgGPU,
		FFmpegSpeed:       ffmpegMet.AvgSpeed,
		FFmpegFPS:         ffmpegMet.AvgFPS,
		FFmpegBitrateKbps: ffmpegMet.LastBitrate,
		Success:           opErr == nil,
		ErrorMessage:      errMsg,
		OutputFormat:      outputFormat,
		VideoCodec:        videoCodec,
		AudioCodec:        audioCodec,
	}
	h.metStore.WriteOperation(rec)
}

func codecStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ─── Metrics API handlers ─────────────────────────────────────────────────────

// MetricsSystemCurrent returns a live system snapshot.
func (h *Handler) MetricsSystemCurrent(c *fiber.Ctx) error {
	if h.collector == nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{"error": "metrics not enabled"})
	}
	snap := h.collector.Current()
	return c.Status(http.StatusOK).JSON(snap)
}

// MetricsOperations returns the last N operation records (default 20).
func (h *Handler) MetricsOperations(c *fiber.Ctx) error {
	if h.metStore == nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{"error": "metrics not enabled"})
	}
	n := 20
	ops := h.metStore.GetLastOperations(n)
	if ops == nil {
		ops = []metrics.OperationRecord{}
	}
	return c.Status(http.StatusOK).JSON(fiber.Map{
		"operations": ops,
		"count":      len(ops),
	})
}

// MetricsSummary returns aggregate statistics over all recorded operations.
func (h *Handler) MetricsSummary(c *fiber.Ctx) error {
	if h.metStore == nil {
		return c.Status(http.StatusServiceUnavailable).JSON(fiber.Map{"error": "metrics not enabled"})
	}
	return c.Status(http.StatusOK).JSON(h.metStore.GetSummary())
}

// ─── resolve timeline target size ────────────────────────────────────────────

func resolveTimelineTargetSize(mediaInfo *models.MediaInfo) (int, int) {
	if mediaInfo == nil || mediaInfo.Resolution == "" {
		return 0, 0
	}

	parts := strings.Split(mediaInfo.Resolution, "x")
	if len(parts) != 2 {
		return 0, 0
	}

	var width, height int
	if _, err := fmt.Sscanf(parts[0], "%d", &width); err != nil {
		return 0, 0
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &height); err != nil {
		return 0, 0
	}

	return width, height
}
