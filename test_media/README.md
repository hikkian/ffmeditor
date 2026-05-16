# Test Media

Place test video files here before running benchmarks.

Recommended files:
- `sample_1080p.mp4` — 1080p, 60 seconds, ~100 MB
- `sample_720p.mp4` — 720p, 60 seconds, ~50 MB
- `sample_short.mp4` — any resolution, 10 seconds (quick tests)

Run benchmark:
```powershell
go run ./cmd/benchmark -file test_media/sample_1080p.mp4
```
