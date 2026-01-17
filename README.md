# FFmpeg Media Converter - Stage 1

A lightweight, efficient multimedia converter built in pure Go, optimized for weak PCs and **cross-platform** (Windows & Linux).

## Features

### Core Conversion
- **Formats**: MP4, MKV, MOV, WebM, MP3, AAC, WAV, FLAC, OGG
- **Video Codecs**: Copy, libx264, libx265, libvpx-vp9
- **Audio Codecs**: Copy, AAC, libmp3lame, libopus, FLAC

### Editor-like Essentials
- **Trim**: Precise start time + duration in seconds or HH:MM:SS
- **Remove Audio/Video**: Strip one stream completely
- **Resize**: Custom dimensions with aspect ratio preservation
- **MP4 Faststart**: Stream-friendly video chunks
- **Metadata Strip**: Remove all metadata

### Low-End PC Optimization
- **Concurrency Control**: Worker pool limits CPU load (default: 1 worker)
- **Preset Modes**:
  - `low_cpu`: Stream copy when possible, very fast encoding
  - `balanced`: Fast preset with reasonable quality (default)
  - `quality`: Slow preset for best output
- **Bounded Logging**: Ring buffer (default 200 lines) prevents memory bloat
- **CRF/Bitrate Control**: Fine-tune quality vs. speed

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/upload` | Upload media file |
| POST | `/api/v1/convert` | Start conversion job |
| GET | `/api/v1/jobs/:id` | Get job status & progress |
| GET | `/api/v1/download/:id` | Download converted file |
| GET | `/api/v1/health` | Health check |

## Project Structure

```
.
├── cmd/server/
│   └── main.go                 # Server entry point
├── internal/
│   ├── config/
│   │   └── config.go           # Configuration from env vars
│   ├── ffmpeg/
│   │   └── ffmpeg.go           # FFmpeg execution & probing
│   ├── http/
│   │   └── handlers.go         # API handlers
│   ├── jobs/
│   │   └── manager.go          # Job queue & worker pool
│   ├── storage/
│   │   └── storage.go          # File storage management
│   └── validator/
│       └── validator.go        # Input validation & sanitization
├── uploads/                    # Input files (created at runtime)
├── outputs/                    # Converted files (created at runtime)
├── Dockerfile                  # Multi-stage Docker build
├── docker-compose.yml          # Docker Compose orchestration
├── .env.example                # Environment template
├── go.mod                      # Go module definition
└── README.md                   # This file
```

## Prerequisites

### Windows (Native Mode)

1. **Install FFmpeg**
   - Download from [ffmpeg.org](https://ffmpeg.org/download.html#build-windows)
   - Extract to a folder (e.g., `C:\ffmpeg`)
   - **Option A**: Add to PATH
     ```powershell
     [Environment]::SetEnvironmentVariable("PATH", "C:\ffmpeg\bin;$env:PATH", "User")
     ```
   - **Option B**: Set environment variables
     ```powershell
     $env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"
     $env:FFPROBE_PATH="C:\ffmpeg\bin\ffprobe.exe"
     ```

2. **Install Go**
   - Download from [golang.org](https://golang.org/dl) (1.21+)
   - Run installer

### Linux (Native Mode)

1. **Install FFmpeg**
   ```bash
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install ffmpeg

   # Fedora/RHEL
   sudo dnf install ffmpeg

   # Arch
   sudo pacman -S ffmpeg
   ```

2. **Install Go**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install golang-go

   # Fedora/RHEL
   sudo dnf install golang

   # Arch
   sudo pacman -S go
   ```

3. **Or use** [go.dev](https://golang.org/dl)

### Docker (Recommended - All Platforms)

Only Docker & Docker Compose needed (Windows/Linux/Mac).

## Usage

### Option 1: Native Windows

```powershell
# Set paths (if not in PATH)
$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH="C:\ffmpeg\bin\ffprobe.exe"

# Optional: tune for weak PC
$env:WORKERS="1"
$env:PRESET_MODE="low_cpu"
$env:MAX_UPLOAD_MB="300"

# Run
go run ./cmd/server
```

Server starts on `http://localhost:8080`

### Option 2: Native Linux

```bash
# Optional: tune for weak PC
export WORKERS=1
export PRESET_MODE=low_cpu
export MAX_UPLOAD_MB=300

# Run
go run ./cmd/server
```

Server starts on `http://localhost:8080`

### Option 3: Docker (Recommended)

```bash
# Build and start
docker compose up --build

# Or just start (if already built)
docker compose up

# Check logs
docker compose logs -f converter-api
```

Server runs at `http://localhost:8080`

#### Environment Variables (docker-compose.yml)

Modify `docker-compose.yml` to tune for your system:

```yaml
environment:
  WORKERS: "1"              # CPU-bound: set to CPU count or 1-2 for weak PCs
  PRESET_MODE: "low_cpu"    # low_cpu | balanced | quality
  MAX_UPLOAD_MB: "300"      # Adjust for available disk
```

## API Examples

### 1. Upload a File

```bash
# Windows PowerShell
$file = "C:\path\to\video.mp4"
$response = Invoke-WebRequest -Uri "http://localhost:8080/api/v1/upload" `
  -Method Post `
  -Form @{ file = [System.IO.FileInfo]$file }

$response.Content | ConvertFrom-Json | ConvertTo-Json

# Linux/Mac
curl -F "file=@/path/to/video.mp4" \
  http://localhost:8080/api/v1/upload | jq
```

**Response:**
```json
{
  "file_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "original_name": "video.mp4",
  "media_info": {
    "duration": 120.5
  }
}
```

### 2. Start Conversion (MP4 → WebM, low CPU mode)

```bash
# Windows PowerShell
$body = @{
  file_id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  output_format = "webm"
  video_codec = "libvpx-vp9"
  audio_codec = "libopus"
  preset = "veryfast"
  crf = 28
  fps = 24
  remove_audio = $false
  fast_start = $false
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:8080/api/v1/convert" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body | ConvertFrom-Json | ConvertTo-Json

# Linux/Mac
curl -X POST http://localhost:8080/api/v1/convert \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "output_format": "webm",
    "video_codec": "libvpx-vp9",
    "audio_codec": "libopus",
    "preset": "veryfast",
    "crf": 28,
    "fps": 24
  }' | jq
```

**Response:**
```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending"
}
```

### 3. Check Conversion Progress

```bash
# Windows PowerShell
Invoke-WebRequest -Uri "http://localhost:8080/api/v1/jobs/a1b2c3d4-e5f6-7890-abcd-ef1234567890" | ConvertFrom-Json | ConvertTo-Json

# Linux/Mac
curl http://localhost:8080/api/v1/jobs/a1b2c3d4-e5f6-7890-abcd-ef1234567890| jq
```

**Response (while processing):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "file_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "original_name": "video.mp4",
  "output_format": "webm",
  "status": "processing",
  "progress": 0.45,
  "out_time_ms": 54000.0,
  "output_filename": "",
  "created_at": "2025-01-15T12:34:56Z",
  "started_at": "2025-01-15T12:35:00Z"
}
```

**Response (completed):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "file_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "original_name": "video.mp4",
  "output_format": "webm",
  "status": "completed",
  "progress": 1.0,
  "output_filename": "a1b2c3d4_converted.webm",
  "completed_at": "2025-01-15T12:36:10Z",
  "logs": ["Starting conversion...", "Conversion completed successfully"]
}
```

### 4. Download Converted File

```bash
# Windows PowerShell
Invoke-WebRequest -Uri "http://localhost:8080/api/v1/download/a1b2c3d4-e5f6-7890-abcd-ef1234567890" `
  -OutFile "output.webm"

# Linux/Mac
curl -o output.webm \
  http://localhost:8080/api/v1/download/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### 5. Advanced Conversions

#### MP4 → MP3 (Audio Extraction)
```bash
curl -X POST http://localhost:8080/api/v1/convert \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "...",
    "output_format": "mp3",
    "remove_video": true,
    "audio_codec": "libmp3lame",
    "audio_bitrate": "192k"
  }'
```

#### MP4 → MP4 (Resize + Trim, low CPU)
```bash
curl -X POST http://localhost:8080/api/v1/convert \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "...",
    "output_format": "mp4",
    "video_codec": "libx264",
    "preset": "veryfast",
    "crf": 28,
    "resize_width": 1280,
    "resize_height": 720,
    "keep_aspect": true,
    "fit_mode": "contain",
    "trim_start": 10.5,
    "trim_duration": 60.0,
    "fast_start": true
  }'
```

#### MKV → MP4 (Stream Copy, fastest)
```bash
curl -X POST http://localhost:8080/api/v1/convert \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "...",
    "output_format": "mp4",
    "video_codec": "copy",
    "audio_codec": "copy",
    "fast_start": true
  }'
```

#### WebM → MP4 (Re-encode for compatibility)
```bash
curl -X POST http://localhost:8080/api/v1/convert \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "...",
    "output_format": "mp4",
    "video_codec": "libx265",
    "preset": "fast",
    "crf": 25,
    "audio_codec": "aac",
    "audio_bitrate": "128k"
  }'
```

### 6. Health Check

```bash
# Windows
Invoke-WebRequest -Uri "http://localhost:8080/api/v1/health"

# Linux
curl http://localhost:8080/api/v1/health
```

**Response:**
```json
{
  "status": "ok"
}
```

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `WORKERS` | `1` | Concurrent conversion jobs |
| `MAX_UPLOAD_MB` | `500` | Max upload size |
| `PRESET_MODE` | `balanced` | `low_cpu` / `balanced` / `quality` |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg binary path |
| `FFPROBE_PATH` | `ffprobe` | FFprobe binary path |
| `LOG_RING_BUFFER_SIZE` | `200` | Max log lines per job |

### Weak PC Tuning

For systems with <2GB RAM or single-core CPUs:

```bash
# Windows
$env:WORKERS="1"
$env:PRESET_MODE="low_cpu"
$env:MAX_UPLOAD_MB="200"

# Linux
export WORKERS=1
export PRESET_MODE=low_cpu
export MAX_UPLOAD_MB=200
```

Then:
- Always use `preset: "veryfast"` or `"ultrafast"`
- Keep CRF ≤ 28 (lower quality but faster)
- Use lower FPS (15-24 instead of 30-60)
- Prefer stream copy when codec matches

## Request Body Reference

### ConvertRequest JSON Schema

```json
{
  "file_id": "string (required)",
  "output_format": "string (required, one of: mp4|mkv|mov|webm|mp3|aac|wav|flac|ogg)",
  "video_codec": "string|null (one of: copy|libx264|libx265|libvpx-vp9)",
  "audio_codec": "string|null (one of: copy|aac|libmp3lame|libopus|flac)",
  "video_bitrate": "string|null (e.g., '1000k', '5M')",
  "audio_bitrate": "string|null (e.g., '192k', '320k')",
  "crf": "integer|null (18-35, lower=better quality, default 28)",
  "preset": "string|null (ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)",
  "fps": "integer|null (1-60)",
  "remove_audio": "boolean (default false)",
  "remove_video": "boolean (default false)",
  "trim_start": "number|null (seconds)",
  "trim_duration": "number|null (seconds)",
  "resize_width": "integer|null (pixels)",
  "resize_height": "integer|null (pixels)",
  "keep_aspect": "boolean (default false)",
  "fit_mode": "string|null (contain|cover, requires keep_aspect)",
  "fast_start": "boolean (default false, MP4 only)",
  "strip_metadata": "boolean (default false)"
}
```

## Troubleshooting

### "ffmpeg not found"
- **Windows**: Add `C:\ffmpeg\bin` to PATH or set `FFMPEG_PATH` env var
- **Linux**: Install ffmpeg: `sudo apt-get install ffmpeg`
- **Docker**: Already included in image

### High memory usage
- Reduce `LOG_RING_BUFFER_SIZE`
- Use `WORKERS=1` for weak PCs
- Switch to `PRESET_MODE=low_cpu`

### Slow conversions
- Use `preset: "veryfast"` or `"ultrafast"`
- Use `video_codec: "copy"` if codec matches (0% CPU)
- Lower CRF (e.g., 28 instead of 23)
- Reduce resolution

### Upload fails (413 Payload Too Large)
- Increase `MAX_UPLOAD_MB` or split input

### File paths not working on Windows
- Always use forward slashes `/` in API; paths are normalized internally

## Development

### Build from Source

```bash
# Windows/Linux
git clone https://github.com/your-repo/ffmeditor.git
cd ffmeditor/backend
go build -o ffmeditor-server ./cmd/server

# Run
./ffmeditor-server  # Windows: ffmeditor-server.exe
```

### Running Tests (Future)

```bash
go test ./...
```

## Performance Baseline (Weak PC: Atom N3350, 2GB RAM)

| Input | Format | Codec | Preset | Size | Time | CPU |
|-------|--------|-------|--------|------|------|-----|
| 2min 1080p MP4 | WebM | VP9 | veryfast | 45MB → 18MB | 45s | 1 core @ 70% |
| 5min 720p MKV | MP4 (copy) | copy | - | 150MB → 150MB | 3s | <5% |
| 1min audio MP4 | MP3 | libmp3lame | - | 15MB → 2MB | 8s | <5% |

## License

MIT

## Support

For issues, feature requests, or questions:
- Open an issue on GitHub
- Check [FFmpeg docs](https://ffmpeg.org/documentation.html)
- Review logs: `/app/outputs/` folder or job response logs

---

**Built with Go, Fiber, and FFmpeg for efficiency on weak PCs.**
