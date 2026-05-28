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
	// HWAccel: "auto" (detect), "none", "cuda", "qsv", "videotoolbox"
	HWAccel string
	// ResolvedHWEncoder is set at startup after probing ffmpeg (e.g. "h264_nvenc", "h264_qsv", "").
	ResolvedHWEncoder string
	// Auth
	AuthUsername string
	AuthPassword string
	AuthSecret   string
	AuthEnabled  bool
}

func Load() *Config {
	port := getEnv("PORT", "8080")
	workers := getEnvInt("WORKERS", 1)
	maxUploadMB := getEnvInt("MAX_UPLOAD_MB", 500)
	presetMode := getEnv("PRESET_MODE", "balanced") // low_cpu, balanced, quality
	ffmpegPath := getEnv("FFMPEG_PATH", "ffmpeg")
	ffprobePath := getEnv("FFPROBE_PATH", "ffprobe")
	logRingBufferSize := getEnvInt("LOG_RING_BUFFER_SIZE", 200)
	hwAccel := getEnv("HWACCEL", "auto") // auto | none | cuda | qsv | videotoolbox

	// Create directories
	uploadDir := filepath.Join(".", "uploads")
	outputDir := filepath.Join(".", "outputs")
	os.MkdirAll(uploadDir, 0755)
	os.MkdirAll(outputDir, 0755)

	authUsername := getEnv("AUTH_USERNAME", "admin")
	authPassword := getEnv("AUTH_PASSWORD", "changeme")
	authSecret := getEnv("AUTH_SECRET", "ffmeditor-secret-key-change-in-production")
	authEnabled := getEnv("AUTH_ENABLED", "true") == "true"

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
		HWAccel:           hwAccel,
		AuthUsername:      authUsername,
		AuthPassword:      authPassword,
		AuthSecret:        authSecret,
		AuthEnabled:       authEnabled,
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
