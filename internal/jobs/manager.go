package jobs

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type JobStatus string

const (
	StatusPending    JobStatus = "pending"
	StatusProcessing JobStatus = "processing"
	StatusCompleted  JobStatus = "completed"
	StatusFailed     JobStatus = "failed"
	StatusCanceled   JobStatus = "canceled"
)

type Job struct {
	ID             string     `json:"id"`
	FileID         string     `json:"file_id"`
	OriginalName   string     `json:"original_name"`
	OutputFormat   string     `json:"output_format"`
	Status         JobStatus  `json:"status"`
	Progress       float64    `json:"progress"`
	OutTimeMs      float64    `json:"out_time_ms"`
	OutputFilename string     `json:"output_filename"`
	Error          string     `json:"error,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	Logs           []string   `json:"logs"`
	LogRingBuffer  []string   // Internal ring buffer
	MaxLogLines    int
}

type Manager struct {
	mu       sync.RWMutex
	jobs     map[string]*Job
	queue    chan *Job
	workers  int
	done     chan struct{}
	handlers map[JobStatus][]JobHandler
}

type JobHandler func(*Job)

func NewManager(workers int) *Manager {
	m := &Manager{
		jobs:     make(map[string]*Job),
		queue:    make(chan *Job, workers*2),
		workers:  workers,
		done:     make(chan struct{}),
		handlers: make(map[JobStatus][]JobHandler),
	}
	return m
}

func (m *Manager) Start() {
	for i := 0; i < m.workers; i++ {
		go m.worker()
	}
}

func (m *Manager) Stop() {
	close(m.done)
}

func (m *Manager) worker() {
	for {
		select {
		case <-m.done:
			return
		case job := <-m.queue:
			if job != nil {
				m.processJob(job)
			}
		}
	}
}

func (m *Manager) processJob(job *Job) {
	m.SetStatus(job.ID, StatusProcessing)
	now := time.Now()
	job.StartedAt = &now

	// Call handlers
	m.callHandlers(job, StatusProcessing)

	// Note: The actual conversion will be handled by the HTTP handler
	// This method is kept for future use or custom logic
}

func (m *Manager) CreateJob(fileID, originalName, outputFormat string) *Job {
	job := &Job{
		ID:            uuid.New().String(),
		FileID:        fileID,
		OriginalName:  originalName,
		OutputFormat:  outputFormat,
		Status:        StatusPending,
		Progress:      0,
		CreatedAt:     time.Now(),
		Logs:          []string{},
		LogRingBuffer: []string{},
		MaxLogLines:   200,
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.jobs[job.ID] = job
	return job
}

func (m *Manager) QueueJob(job *Job) {
	m.queue <- job
}

func (m *Manager) GetJob(id string) *Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.jobs[id]
}

func (m *Manager) SetProgress(jobID string, progress, outTimeMs float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Progress = progress
		job.OutTimeMs = outTimeMs
	}
}

func (m *Manager) SetStatus(jobID string, status JobStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Status = status
		if status == StatusCompleted || status == StatusFailed || status == StatusCanceled {
			now := time.Now()
			job.CompletedAt = &now
		}
	}
}

func (m *Manager) SetError(jobID, errMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Error = errMsg
		job.Status = StatusFailed
		now := time.Now()
		job.CompletedAt = &now
	}
}

func (m *Manager) SetCompleted(jobID, outputFilename string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Status = StatusCompleted
		job.OutputFilename = outputFilename
		job.Progress = 1.0
		now := time.Now()
		job.CompletedAt = &now
		m.callHandlers(job, StatusCompleted)
	}
}

func (m *Manager) AddLog(jobID, logMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.LogRingBuffer = append(job.LogRingBuffer, logMsg)
		if len(job.LogRingBuffer) > job.MaxLogLines {
			job.LogRingBuffer = job.LogRingBuffer[1:]
		}
		job.Logs = job.LogRingBuffer
	}
}

func (m *Manager) AllJobs() map[string]*Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make(map[string]*Job)
	for k, v := range m.jobs {
		result[k] = v
	}
	return result
}

func (m *Manager) On(status JobStatus, handler JobHandler) {
	if m.handlers[status] == nil {
		m.handlers[status] = []JobHandler{}
	}
	m.handlers[status] = append(m.handlers[status], handler)
}

func (m *Manager) callHandlers(job *Job, status JobStatus) {
	if handlers, exists := m.handlers[status]; exists {
		for _, handler := range handlers {
			go handler(job)
		}
	}
}

func (m *Manager) DeleteJob(jobID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.jobs, jobID)
}

func (m *Manager) GetJobsByStatus(status JobStatus) []*Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var result []*Job
	for _, job := range m.jobs {
		if job.Status == status {
			result = append(result, job)
		}
	}
	return result
}
