package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"

	"ffmeditor/internal/config"
	apphttp "ffmeditor/internal/http"
	"ffmeditor/internal/jobs"
	"ffmeditor/internal/metrics"
	"ffmeditor/internal/storage"
)

func main() {
	cfg := config.Load()

	// Initialize components
	store := storage.NewStorage(cfg.UploadDir)
	jobManager := jobs.NewManager(cfg.Workers)
	jobManager.Start()
	defer jobManager.Stop()

	// Initialize metrics collector (sample every 2s, keep last 1800 samples = 1 hour)
	collector := metrics.NewCollector(2*time.Second, 1800)
	collector.Start()
	defer collector.Stop()

	metricsStore, err := metrics.NewStore("metrics")
	if err != nil {
		log.Printf("Warning: metrics store disabled: %v", err)
		metricsStore = nil
	} else {
		defer metricsStore.Close()
	}
	if collector.GPUAvailable() {
		log.Println("GPU metrics: enabled (nvidia-smi detected)")
	} else {
		log.Println("GPU metrics: disabled (nvidia-smi not found)")
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:   "FFmpeg Media Converter v1.0",
		BodyLimit: cfg.MaxUploadMB * 1024 * 1024,
	})

	// Middleware
	app.Use(logger.New())

	// CORS: restrict to known origins. Override via CORS_ORIGIN env var in production.
	corsOrigins := "http://localhost:5173,http://localhost:5174,http://localhost:4173"
	if envOrigin := os.Getenv("CORS_ORIGIN"); envOrigin != "" {
		corsOrigins = envOrigin
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins: corsOrigins,
		AllowMethods: "GET,POST,DELETE,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	// Register handlers
	handler := apphttp.NewHandler(cfg, store, jobManager, collector, metricsStore)
	handler.RegisterRoutes(app)

	// Start server
	log.Printf("Starting server on port %s", cfg.Port)
	log.Printf("Workers: %d, Upload limit: %d MB, Preset mode: %s", cfg.Workers, cfg.MaxUploadMB, cfg.PresetMode)
	log.Printf("FFmpeg: %s, FFprobe: %s", cfg.FFmpegPath, cfg.FFprobePath)
	log.Printf("Upload dir: %s, Output dir: %s", cfg.UploadDir, cfg.OutputDir)
	log.Printf("CORS origins: %s", corsOrigins)

	// Graceful shutdown: wait for SIGINT/SIGTERM before stopping.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := app.Listen(":" + cfg.Port); err != nil {
			log.Fatalf("Error starting server: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down server...")
	if err := app.Shutdown(); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
}
