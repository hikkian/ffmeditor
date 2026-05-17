# Build stage
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY . .

RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o ffmeditor-server ./cmd/server

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ffmpeg ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/ffmeditor-server /app/

# Create working directories
RUN mkdir -p /app/uploads /app/outputs && \
    chmod 755 /app/uploads /app/outputs

# Expose port
EXPOSE 8080

# Set environment defaults
ENV PORT=8080 \
    WORKERS=1 \
    MAX_UPLOAD_MB=500 \
    PRESET_MODE=balanced \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    LOG_RING_BUFFER_SIZE=200

CMD ["./ffmeditor-server"]
