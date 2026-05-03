import { create } from 'zustand';
import { uploadFile, startConvert, startMerge, getJobStatus, getDownloadUrl, deleteFile } from './api';

const useStore = create((set, get) => ({
  // === Media Library ===
  files: [],
  activeFileId: null,
  activeFile: null,
  selectedFileIds: [], // For merge

  // === Video Preview ===
  videoUrl: null,
  videoDuration: 0,
  currentTime: 0,

  // === Editing Controls ===
  trimStart: 0,
  trimDuration: 0,
  resizeWidth: '',
  resizeHeight: '',
  keepAspect: true,
  outputFormat: 'mp4',
  videoCodec: 'libx264',
  audioCodec: 'aac',
  removeAudio: false,
  preset: 'fast',
  crf: 23,
  videoBitrate: '',
  audioBitrate: '',
  fastStart: true,
  brightness: 0,
  contrast: 1.0,
  volume: 1.0,

  // === Export / Job State ===
  isUploading: false,
  uploadProgress: 0,
  isExporting: false,
  jobId: null,
  jobStatus: null,
  jobProgress: 0,
  jobError: null,
  downloadReady: false,

  // === Error ===
  error: null,

  // === Actions ===

  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),

  setCurrentTime: (t) => set({ currentTime: t }),
  setVideoDuration: (d) => {
    set({ videoDuration: d, trimDuration: d, trimStart: 0 });
  },

  setTrimStart: (v) => set({ trimStart: v }),
  setTrimDuration: (v) => set({ trimDuration: v }),
  setResizeWidth: (v) => set({ resizeWidth: v }),
  setResizeHeight: (v) => set({ resizeHeight: v }),
  setKeepAspect: (v) => set({ keepAspect: v }),
  setOutputFormat: (v) => set({ outputFormat: v }),
  setVideoCodec: (v) => set({ videoCodec: v }),
  setAudioCodec: (v) => set({ audioCodec: v }),
  setRemoveAudio: (v) => set({ removeAudio: v }),
  setPreset: (v) => set({ preset: v }),
  setCrf: (v) => set({ crf: v }),
  setVideoBitrate: (v) => set({ videoBitrate: v }),
  setAudioBitrate: (v) => set({ audioBitrate: v }),
  setFastStart: (v) => set({ fastStart: v }),
  setBrightness: (v) => set({ brightness: v }),
  setContrast: (v) => set({ contrast: v }),
  setVolume: (v) => set({ volume: v }),

  // Upload
  handleUpload: async (file) => {
    set({ isUploading: true, uploadProgress: 0, error: null });
    try {
      const result = await uploadFile(file, (pct) => {
        set({ uploadProgress: pct });
      });

      const localUrl = URL.createObjectURL(file);

      // Extract video dimensions via a temp video element
      const dimensions = await new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.onloadedmetadata = () => {
          resolve({ width: vid.videoWidth, height: vid.videoHeight });
        };
        vid.onerror = () => resolve({ width: 0, height: 0 });
        vid.src = localUrl;
      });

      const fileEntry = {
        id: result.file_id,
        name: result.original_name,
        duration: result.media_info?.duration || 0,
        hasVideo: result.media_info?.has_video || false,
        hasAudio: result.media_info?.has_audio || false,
        videoCodec: result.media_info?.video_codec || '',
        audioCodec: result.media_info?.audio_codec || '',
        localUrl,
        fileSize: file.size,
        width: dimensions.width,
        height: dimensions.height,
      };

      set((state) => ({
        files: [...state.files, fileEntry],
        isUploading: false,
        uploadProgress: 100,
      }));

      // Auto-select the uploaded file
      get().selectFile(fileEntry.id);

      return fileEntry;
    } catch (err) {
      set({
        isUploading: false,
        error: err.response?.data?.error || err.message || 'Upload failed',
      });
      return null;
    }
  },

  // Select file
  selectFile: (fileId) => {
    const file = get().files.find((f) => f.id === fileId);
    if (!file) return;
    set({
      activeFileId: fileId,
      activeFile: file,
      videoUrl: file.localUrl,
      trimStart: 0,
      trimDuration: file.duration || 0,
      jobId: null,
      jobStatus: null,
      jobProgress: 0,
      jobError: null,
    });
  },

  toggleSelection: (fileId) => set((state) => ({
    selectedFileIds: state.selectedFileIds.includes(fileId)
      ? state.selectedFileIds.filter((id) => id !== fileId)
      : [...state.selectedFileIds, fileId],
  })),

  // Export
  handleExport: async () => {
    const state = get();
    if (!state.activeFileId) {
      set({ error: 'No file selected' });
      return;
    }

    set({
      isExporting: true,
      jobProgress: 0,
      jobStatus: 'pending',
      jobError: null,
      downloadReady: false,
      error: null,
    });

    const payload = {
      file_id: state.activeFileId,
      output_format: state.outputFormat,
      video_codec: state.videoCodec,
      audio_codec: state.audioCodec,
      remove_audio: state.removeAudio,
      preset: state.preset,
      crf: state.crf,
      fast_start: state.fastStart,
    };

    if (state.trimStart > 0) payload.trim_start = state.trimStart;
    if (state.trimDuration > 0 && state.trimDuration < state.videoDuration) {
      payload.trim_duration = state.trimDuration;
    }
    if (state.resizeWidth) payload.resize_width = parseInt(state.resizeWidth, 10);
    if (state.resizeHeight) payload.resize_height = parseInt(state.resizeHeight, 10);
    if (state.resizeWidth || state.resizeHeight) payload.keep_aspect = state.keepAspect;
    if (state.videoBitrate) payload.video_bitrate = state.videoBitrate.toString();
    if (state.audioBitrate) payload.audio_bitrate = state.audioBitrate.toString();
    if (state.brightness !== 0) payload.brightness = state.brightness;
    if (state.contrast !== 1.0) payload.contrast = state.contrast;
    if (state.volume !== 1.0) payload.volume = state.volume;

    try {
      const result = await startConvert(payload);
      set({ jobId: result.job_id, jobStatus: result.status });

      // Start polling
      get().pollJob(result.job_id);
    } catch (err) {
      set({
        isExporting: false,
        jobError: err.response?.data?.error || err.message || 'Export failed',
        error: err.response?.data?.error || err.message || 'Export failed',
      });
    }
  },

  handleMerge: async () => {
    const state = get();
    if (state.selectedFileIds.length < 2) {
      set({ error: 'Select at least 2 files to merge' });
      return;
    }

    set({
      isExporting: true,
      jobProgress: 0,
      jobStatus: 'pending',
      jobError: null,
      downloadReady: false,
      error: null,
    });

    const payload = {
      file_ids: state.selectedFileIds,
      output_format: state.outputFormat,
    };

    try {
      const result = await startMerge(payload);
      set({ jobId: result.job_id, jobStatus: result.status });
      get().pollJob(result.job_id);
    } catch (err) {
      set({
        isExporting: false,
        jobError: err.response?.data?.error || err.message || 'Merge failed',
        error: err.response?.data?.error || err.message || 'Merge failed',
      });
    }
  },

  pollJob: (jobId) => {
    const interval = setInterval(async () => {
      try {
        const job = await getJobStatus(jobId);
        set({
          jobStatus: job.status,
          jobProgress: job.progress || 0,
        });

        if (job.status === 'completed') {
          clearInterval(interval);
          set({
            isExporting: false,
            downloadReady: true,
            jobProgress: 1,
          });
        } else if (job.status === 'failed') {
          clearInterval(interval);
          const errorMsg = job.error || 'Conversion failed';
          set({
            isExporting: false,
            jobError: errorMsg,
            error: errorMsg,
          });
        }
      } catch (err) {
        clearInterval(interval);
        set({
          isExporting: false,
          jobError: 'Lost connection to server',
          error: 'Lost connection to server',
        });
      }
    }, 1000);
  },

  getDownloadLink: () => {
    const { jobId } = get();
    if (!jobId) return null;
    return getDownloadUrl(jobId);
  },

  removeFile: async (fileId) => {
    try {
      await deleteFile(fileId);
    } catch (err) {
      console.error('Failed to delete on server', err);
    }

    set((state) => {
      const fileToRemove = state.files.find((f) => f.id === fileId);
      if (fileToRemove?.localUrl) {
        URL.revokeObjectURL(fileToRemove.localUrl);
      }
      
      const newFiles = state.files.filter((f) => f.id !== fileId);
      const newSelected = state.selectedFileIds.filter((id) => id !== fileId);
      const wasActive = state.activeFileId === fileId;
      return {
        files: newFiles,
        selectedFileIds: newSelected,
        ...(wasActive
          ? {
              activeFileId: null,
              activeFile: null,
              videoUrl: null,
              videoDuration: 0,
            }
          : {}),
      };
    });
  },
}));

export default useStore;
