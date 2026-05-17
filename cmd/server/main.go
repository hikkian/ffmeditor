package main

import (
	"log"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"

	"ffmeditor/internal/config"
	"ffmeditor/internal/ffmpeg"
	"ffmeditor/internal/http"
	"ffmeditor/internal/jobs"
	"ffmeditor/internal/metrics"
	"ffmeditor/internal/storage"
)

func main() {
	cfg := config.Load()

	// Initialize components
	metrics.Start()

	// Detect hardware encoder once at startup.
	if cfg.HWAccel != "none" {
		hw := ffmpeg.DetectHardwareEncoder(cfg.FFmpegPath)
		cfg.ResolvedHWEncoder = ffmpeg.HWEncoderCodec(hw)
		if cfg.ResolvedHWEncoder != "" {
			log.Printf("Hardware encoder detected: %s (%s)", hw, cfg.ResolvedHWEncoder)
		} else {
			log.Printf("No hardware encoder detected, using libx264")
		}
	}

	store := storage.NewStorage(cfg.UploadDir)
	jobManager := jobs.NewManager(cfg.Workers)
	opStore := metrics.NewOperationStore(filepath.Join(cfg.OutputDir, "operations.json"))
	jobManager.Start()
	defer jobManager.Stop()

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:   "FFmpeg Media Converter v1.0",
		BodyLimit: cfg.MaxUploadMB * 1024 * 1024, // Set body limit in bytes
	})

	// Middleware
	app.Use(logger.New())
	app.Use(cors.New())

	// Register handlers
	handler := http.NewHandler(cfg, store, jobManager, opStore)
	handler.RegisterRoutes(app)

	// Start server
	log.Printf("Starting server on port %s", cfg.Port)
	log.Printf("Workers: %d, Upload limit: %d MB, Preset mode: %s", cfg.Workers, cfg.MaxUploadMB, cfg.PresetMode)
	log.Printf("FFmpeg: %s, FFprobe: %s", cfg.FFmpegPath, cfg.FFprobePath)
	log.Printf("Upload dir: %s, Output dir: %s", cfg.UploadDir, cfg.OutputDir)

	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}
