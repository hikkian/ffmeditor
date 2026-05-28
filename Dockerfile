# Frontend build stage
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Backend build stage
FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build
# Copy only dependency files first — this layer is cached until go.mod/go.sum change
COPY go.mod go.sum ./
RUN go mod download
# Now copy the rest of the source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o ffmeditor-server ./cmd/server

# Runtime stage
FROM alpine:latest

RUN apk add --no-cache ffmpeg ca-certificates

WORKDIR /app

COPY --from=builder /build/ffmeditor-server /app/
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

RUN mkdir -p /app/uploads /app/outputs && \
    chmod 755 /app/uploads /app/outputs

EXPOSE 8080

ENV PORT=8080 \
    WORKERS=1 \
    MAX_UPLOAD_MB=500 \
    PRESET_MODE=balanced \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    LOG_RING_BUFFER_SIZE=200

CMD ["./ffmeditor-server"]
