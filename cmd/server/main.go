package main

import (
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"

	"ffmeditor/internal/config"
	"ffmeditor/internal/http"
	"ffmeditor/internal/jobs"
	"ffmeditor/internal/storage"
)

func main() {
	cfg := config.Load()

	// Initialize components
	store := storage.NewStorage(cfg.UploadDir)
	jobManager := jobs.NewManager(cfg.Workers)
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
	handler := http.NewHandler(cfg, store, jobManager)
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
