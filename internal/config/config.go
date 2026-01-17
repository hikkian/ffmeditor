package config

import (
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port              string
	Workers           int
	MaxUploadMB       int
	PresetMode        string
	FFmpegPath        string
	FFprobePath       string
	UploadDir         string
	OutputDir         string
	LogRingBufferSize int
}

func Load() *Config {
	port := getEnv("PORT", "8080")
	workers := getEnvInt("WORKERS", 1)
	maxUploadMB := getEnvInt("MAX_UPLOAD_MB", 500)
	presetMode := getEnv("PRESET_MODE", "balanced") // low_cpu, balanced, quality
	ffmpegPath := getEnv("FFMPEG_PATH", "ffmpeg")
	ffprobePath := getEnv("FFPROBE_PATH", "ffprobe")
	logRingBufferSize := getEnvInt("LOG_RING_BUFFER_SIZE", 200)

	// Create directories
	uploadDir := filepath.Join(".", "uploads")
	outputDir := filepath.Join(".", "outputs")
	os.MkdirAll(uploadDir, 0755)
	os.MkdirAll(outputDir, 0755)

	return &Config{
		Port:              port,
		Workers:           workers,
		MaxUploadMB:       maxUploadMB,
		PresetMode:        presetMode,
		FFmpegPath:        ffmpegPath,
		FFprobePath:       ffprobePath,
		UploadDir:         uploadDir,
		OutputDir:         outputDir,
		LogRingBufferSize: logRingBufferSize,
	}
}

func getEnv(key, defaultVal string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if value, exists := os.LookupEnv(key); exists {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultVal
}
