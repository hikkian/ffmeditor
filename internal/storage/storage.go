package storage

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"
)

type MediaInfo struct {
	Duration   *float64 // in seconds
	HasVideo   bool
	HasAudio   bool
	VideoCodec string
	AudioCodec string
	Resolution string
}

type UploadedFile struct {
	ID           string
	OriginalName string
	StoragePath  string
	MediaInfo    *MediaInfo
	UploadedAt   time.Time
}

type Storage struct {
	mu      sync.RWMutex
	files   map[string]*UploadedFile
	baseDir string
}

func NewStorage(baseDir string) *Storage {
	return &Storage{
		files:   make(map[string]*UploadedFile),
		baseDir: baseDir,
	}
}

func (s *Storage) Store(file *UploadedFile) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[file.ID] = file
}

func (s *Storage) Get(id string) *UploadedFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.files[id]
}

func (s *Storage) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, id)
}

func (s *Storage) GetStoragePath(id, ext string) string {
	return filepath.Join(s.baseDir, fmt.Sprintf("%s.%s", id, ext))
}

func (s *Storage) All() map[string]*UploadedFile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]*UploadedFile)
	for k, v := range s.files {
		result[k] = v
	}
	return result
}
