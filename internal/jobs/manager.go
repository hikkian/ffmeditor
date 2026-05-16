package jobs

import (
	"context"
	"errors"
	"os"
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
	OutputPath     string     `json:"-"`
	Error          string     `json:"error,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	Logs           []string   `json:"logs"`
	LogRingBuffer  []string   // Internal ring buffer
	MaxLogLines    int
	cancelFunc     context.CancelFunc `json:"-"`
}

type jobTask struct {
	job *Job
	run func(context.Context)
}

type Manager struct {
	mu       sync.RWMutex
	jobs     map[string]*Job
	queue    chan *jobTask
	workers  int
	done     chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
	ctx      context.Context
	cancel   context.CancelFunc
	handlers map[JobStatus][]JobHandler
}

type JobHandler func(*Job)

func NewManager(workers int) *Manager {
	if workers < 1 {
		workers = 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		jobs:     make(map[string]*Job),
		queue:    make(chan *jobTask, workers*2),
		workers:  workers,
		done:     make(chan struct{}),
		ctx:      ctx,
		cancel:   cancel,
		handlers: make(map[JobStatus][]JobHandler),
	}
	return m
}

func (m *Manager) Start() {
	for i := 0; i < m.workers; i++ {
		m.wg.Add(1)
		go m.worker()
	}
	// Stuck job cleanup routine
	m.wg.Add(1)
	go m.cleanupRoutine()
}

func (m *Manager) cleanupRoutine() {
	defer m.wg.Done()
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			now := time.Now()
			for _, job := range m.jobs {
				if job.Status == StatusProcessing && job.StartedAt != nil {
					if now.Sub(*job.StartedAt) > 2*time.Hour {
						if job.cancelFunc != nil {
							job.cancelFunc()
						}
					}
				}
			}
			m.mu.Unlock()
		}
	}
}

func (m *Manager) Stop() {
	m.stopOnce.Do(func() {
		if m.cancel != nil {
			m.cancel() // cancels all running job contexts
		}
		close(m.done)
	})
	m.wg.Wait()
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		select {
		case <-m.ctx.Done():
			return
		case task := <-m.queue:
			if task != nil {
				m.setJobStarted(task.job.ID)
				jobCtx, jobCancel := context.WithCancel(m.ctx)
				m.mu.Lock()
				task.job.cancelFunc = jobCancel
				m.mu.Unlock()

				task.run(jobCtx)

				m.mu.Lock()
				task.job.cancelFunc = nil
				m.mu.Unlock()
				jobCancel()
			}
		}
	}
}

func (m *Manager) setJobStarted(jobID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		now := time.Now()
		job.StartedAt = &now
		job.Status = StatusProcessing
	}
}

func (m *Manager) CancelJob(jobID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, exists := m.jobs[jobID]
	if !exists {
		return errors.New("job not found")
	}
	if job.Status != StatusProcessing {
		return errors.New("job is not processing")
	}
	if job.cancelFunc != nil {
		job.cancelFunc()
		return nil
	}
	return errors.New("job cannot be canceled")
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

func (m *Manager) Enqueue(job *Job, run func(context.Context)) error {
	task := &jobTask{job: job, run: run}
	select {
	case <-m.done:
		return errors.New("job manager stopped")
	case m.queue <- task:
		return nil
	default:
		return errors.New("job queue full")
	}
}

func (m *Manager) GetJob(id string) *Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok {
		return nil
	}
	return cloneJob(job)
}

func (m *Manager) SetProgress(jobID string, progress, outTimeMs float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		if progress < 0 {
			progress = 0
		}
		if progress > 1 {
			progress = progress / 100
		}
		if progress > 1 {
			progress = 1
		}
		job.Progress = progress
		job.OutTimeMs = outTimeMs
	}
}

func (m *Manager) SetError(jobID, errMsg string) {
	m.mu.Lock()
	job, exists := m.jobs[jobID]
	if exists {
		job.Error = errMsg
		job.Status = StatusFailed
		now := time.Now()
		job.CompletedAt = &now
	}
	m.mu.Unlock()
	if exists {
		m.callHandlers(job, StatusFailed)
		m.scheduleCleanup(jobID, job.OutputPath, time.Hour)
	}
}

func (m *Manager) SetCompleted(jobID, outputFilename string) {
	m.mu.Lock()
	job, exists := m.jobs[jobID]
	if exists {
		job.Status = StatusCompleted
		job.OutputFilename = outputFilename
		job.Progress = 1.0
		now := time.Now()
		job.CompletedAt = &now
	}
	m.mu.Unlock()
	if exists {
		m.callHandlers(job, StatusCompleted)
		m.scheduleCleanup(jobID, job.OutputPath, time.Hour)
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
		result[k] = cloneJob(v)
	}
	return result
}

func (m *Manager) On(status JobStatus, handler JobHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.handlers[status] == nil {
		m.handlers[status] = []JobHandler{}
	}
	m.handlers[status] = append(m.handlers[status], handler)
}

func (m *Manager) callHandlers(job *Job, status JobStatus) {
	m.mu.RLock()
	handlers := append([]JobHandler(nil), m.handlers[status]...)
	m.mu.RUnlock()
	for _, handler := range handlers {
		go handler(job)
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
			result = append(result, cloneJob(job))
		}
	}
	return result
}

func (m *Manager) scheduleCleanup(jobID, outputPath string, delay time.Duration) {
	time.AfterFunc(delay, func() {
		if outputPath != "" {
			_ = os.Remove(outputPath)
		}
		m.DeleteJob(jobID)
	})
}

func (m *Manager) SetOutputPath(jobID, outputPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.OutputPath = outputPath
	}
}

func cloneJob(job *Job) *Job {
	if job == nil {
		return nil
	}

	clone := *job
	if job.Logs != nil {
		clone.Logs = append([]string(nil), job.Logs...)
	}
	if job.LogRingBuffer != nil {
		clone.LogRingBuffer = append([]string(nil), job.LogRingBuffer...)
	}
	return &clone
}
