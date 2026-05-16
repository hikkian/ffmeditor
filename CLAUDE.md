# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
# Run the server (Windows)
$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"; $env:FFPROBE_PATH="C:\ffmpeg\bin\ffprobe.exe"
go run ./cmd/server

# Run the server (Linux/Mac)
go run ./cmd/server

# Build binary
go build -o ffmeditor-server ./cmd/server

# Run tests
go test ./...

# Docker (recommended, cross-platform)
docker compose up --build
docker compose logs -f converter-api
```

## Architecture

The backend is a Go (Fiber v2) HTTP API wrapping FFmpeg. All state is in-memory; there is no database. Files are stored on disk under `./uploads/` and `./outputs/` (created at startup).

**Request flow:**
1. `POST /api/v1/upload` → saves file to `./uploads/<uuid>.<ext>`, runs `ffprobe` for media info, returns `file_id`
2. `POST /api/v1/convert|/merge|/timeline/export` → creates a `Job`, enqueues it on the worker pool
3. Worker goroutine executes FFmpeg as a subprocess, parses `out_time_ms=` from `ffmpeg -progress pipe:1` stdout for live progress
4. `GET /api/v1/jobs/:id` → poll status/progress; `GET /api/v1/download/:id` → streams the output file
5. Completed/failed jobs and their output files are auto-deleted after 1 hour; stuck processing jobs (>2h) are auto-canceled

**Key packages:**
- `internal/config` — all config via env vars (see `.env.example`)
- `internal/jobs` — in-memory job store + worker pool (`Manager`), protected by `sync.RWMutex`; `cloneJob` is used on every read to avoid races
- `internal/ffmpeg/ffmpeg.go` — `Convert()` and `Merge()` build FFmpeg args and parse progress; `-ss` is placed before `-i` for fast input seeking
- `internal/ffmpeg/timeline.go` — `ExportTimeline()` renders each clip to a temp file then concat-demuxes them; uses a temp workdir cleaned up after export
- `internal/http/handlers.go` — Fiber handlers; `RegisterRoutes` lists all endpoints
- `internal/validator` — allowlists for formats, codecs, presets; `validateCodecCompatibility` enforces format/codec pairs (e.g., VP9 is invalid in MP4)
- `internal/storage` — in-memory map of uploaded files (`UploadedFile`), keyed by UUID

**Three processing modes** controlled by `PRESET_MODE`:
- `low_cpu` → `veryfast` preset (optimized for single-core/weak hardware)
- `balanced` → `fast` preset (default)
- `quality` → `slow` preset

**CORS** defaults to `localhost:5173,5174,4173` (Vite dev/preview ports); override with `CORS_ORIGIN` env var for production.

**Worker pool** queue size is `workers * 2`; returns `503` when full. Default: 1 worker.

**Log ring buffer** per job (default 200 lines) — bounded to prevent memory bloat on long conversions.
