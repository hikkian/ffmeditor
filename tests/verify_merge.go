package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"ffmeditor/internal/ffmpeg"
)

func main() {
	opts := ffmpeg.MergeOptions{
		InputPaths:  []string{"tests/v1.mp4", "tests/v2.mp4"},
		OutputPath:  "tests/merged.mp4",
		FFmpegPath:  "ffmpeg",
		FFprobePath: "ffprobe",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	defer cancel()

	fmt.Println("Starting merge test...")
	err := ffmpeg.Merge(ctx, opts, func(current, total, outTimeMs float64) {
		fmt.Printf("Progress: %.2f ms\n", outTimeMs)
	}, nil)

	if err != nil {
		fmt.Printf("Merge failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Merge successful!")
	
	// Check if output exists and has info
	info, err := ffmpeg.GetMediaInfo(ctx, "ffprobe", "tests/merged.mp4")
	if err != nil {
		fmt.Printf("Failed to probe merged file: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Printf("Merged info: Video=%v, Audio=%v, Resolution=%s, Duration=%.2f\n", 
		info.HasVideo, info.HasAudio, info.Resolution, *info.Duration)
}
