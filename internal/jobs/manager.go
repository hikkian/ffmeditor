package jobs

import (
	"context"
	"encoding/json"
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
	Stage          string     `json:"stage,omitempty"`
	Progress       float64    `json:"progress"`
	OutTimeMs      float64    `json:"out_time_ms"`
	Strategy       string     `json:"strategy,omitempty"` // "stream_copy" | "reencode"
	ElapsedSecs    float64    `json:"elapsed_secs,omitempty"`
	OutputFilename string     `json:"output_filename"`
	OutputPath     string     `json:"-"`
	Error          string     `json:"error,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	Logs           []string   `json:"logs"`
	LogRingBuffer  []string   `json:"-"`
	MaxLogLines    int        `json:"-"`

	// cancelFn cancels the job's context; set by the worker goroutine.
	cancelFn context.CancelFunc
	startWall time.Time
}

type jobTask struct {
	job *Job
	run func()
}

type Manager struct {
	mu          sync.RWMutex
	jobs        map[string]*Job
	queue       chan *jobTask
	workers     int
	done        chan struct{}
	stopOnce    sync.Once
	wg          sync.WaitGroup
	handlers    map[JobStatus][]JobHandler
	persistPath string // path to jobs.json for completed job persistence
}

type JobHandler func(*Job)

func NewManager(workers int) *Manager {
	if workers < 1 {
		workers = 1
	}
	return &Manager{
		jobs:     make(map[string]*Job),
		queue:    make(chan *jobTask, workers*4),
		workers:  workers,
		done:     make(chan struct{}),
		handlers: make(map[JobStatus][]JobHandler),
	}
}

// WithPersistence sets the path for saving/loading completed jobs.
func (m *Manager) WithPersistence(path string) *Manager {
	m.persistPath = path
	m.loadCompleted()
	return m
}

// loadCompleted restores completed jobs from disk on startup.
func (m *Manager) loadCompleted() {
	if m.persistPath == "" {
		return
	}
	data, err := os.ReadFile(m.persistPath)
	if err != nil {
		return
	}
	var saved []*Job
	if err := json.Unmarshal(data, &saved); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range saved {
		// Only restore if the output file still exists on disk
		if job.OutputFilename != "" && job.OutputPath != "" {
			if _, err := os.Stat(job.OutputPath); err == nil {
				m.jobs[job.ID] = job
			}
		}
	}
}

// saveCompleted writes all completed jobs to disk (called after each completion).
func (m *Manager) saveCompleted() {
	if m.persistPath == "" {
		return
	}
	m.mu.RLock()
	var completed []*Job
	for _, job := range m.jobs {
		if job.Status == StatusCompleted {
			clone := cloneJob(job)
			completed = append(completed, clone)
		}
	}
	m.mu.RUnlock()
	data, err := json.Marshal(completed)
	if err != nil {
		return
	}
	_ = os.WriteFile(m.persistPath, data, 0644)
}

func (m *Manager) Start() {
	for i := 0; i < m.workers; i++ {
		m.wg.Add(1)
		go m.worker()
	}
}

func (m *Manager) Stop() {
	m.stopOnce.Do(func() { close(m.done) })
	m.wg.Wait()
}

func (m *Manager) worker() {
	defer m.wg.Done()
	for {
		select {
		case <-m.done:
			return
		case task := <-m.queue:
			if task != nil {
				m.setJobStarted(task.job.ID)
				task.run()
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
		job.startWall = now
		job.Status = StatusProcessing
		job.Stage = "preparing"
	}
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

func (m *Manager) Enqueue(job *Job, run func()) error {
	task := &jobTask{job: job, run: run}
	select {
	case <-m.done:
		return errors.New("job manager stopped")
	case m.queue <- task:
		return nil
	default:
		return errors.New("job queue full — try again shortly")
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
		job.Progress = progress
		job.OutTimeMs = outTimeMs
	}
}

func (m *Manager) SetStage(jobID, stage string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Stage = stage
	}
}

func (m *Manager) SetStrategy(jobID, strategy string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.Strategy = strategy
	}
}

// SetCancelFunc stores the context cancel function so Cancel() can abort the job.
func (m *Manager) SetCancelFunc(jobID string, fn context.CancelFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		job.cancelFn = fn
	}
}

// Cancel aborts the job if it is still running. Returns true if a cancel was issued.
func (m *Manager) Cancel(jobID string) bool {
	m.mu.Lock()
	job, exists := m.jobs[jobID]
	if !exists {
		m.mu.Unlock()
		return false
	}
	if job.Status != StatusPending && job.Status != StatusProcessing {
		m.mu.Unlock()
		return false
	}
	fn := job.cancelFn
	job.Status = StatusCanceled
	now := time.Now()
	job.CompletedAt = &now
	m.mu.Unlock()

	if fn != nil {
		fn()
	}
	return true
}

func (m *Manager) SetError(jobID, errMsg string) {
	m.mu.Lock()
	job, exists := m.jobs[jobID]
	if exists {
		job.Error = errMsg
		job.Status = StatusFailed
		now := time.Now()
		job.CompletedAt = &now
		if !job.startWall.IsZero() {
			job.ElapsedSecs = time.Since(job.startWall).Seconds()
		}
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
		job.Stage = "done"
		now := time.Now()
		job.CompletedAt = &now
		if !job.startWall.IsZero() {
			job.ElapsedSecs = time.Since(job.startWall).Seconds()
		}
	}
	m.mu.Unlock()
	if exists {
		m.saveCompleted()
		m.callHandlers(job, StatusCompleted)
		m.scheduleCleanup(jobID, job.OutputPath, 24*time.Hour)
	}
}

func (m *Manager) AddLog(jobID, logMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, exists := m.jobs[jobID]; exists {
		entry := time.Now().Format("15:04:05") + " " + logMsg
		job.LogRingBuffer = append(job.LogRingBuffer, entry)
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
	clone.cancelFn = nil // don't expose cancel to callers
	if job.Logs != nil {
		clone.Logs = append([]string(nil), job.Logs...)
	}
	if job.LogRingBuffer != nil {
		clone.LogRingBuffer = append([]string(nil), job.LogRingBuffer...)
	}
	return &clone
}
