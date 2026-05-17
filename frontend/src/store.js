import { create } from 'zustand';
import { uploadFile, startMerge, startTimelineExport, getJobStatus, getDownloadUrl, deleteFile, cancelJob, getFileWaveform } from './api';
import { generateWaveformPeaks } from './utils/waveform';
import { debugLog, debugWarn, debugError } from './utils/debug';
import { clamp } from './utils/helpers';

let activePollInterval = null;

const MIN_CLIP_DURATION = 0.5;
const AUDIO_ONLY_FORMATS = new Set(['mp3', 'aac', 'wav', 'flac', 'ogg', 'm4a']);

const isAudioOnlyFormat = (format) => AUDIO_ONLY_FORMATS.has(String(format || '').toLowerCase());

const createId = (prefix) => {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return `${prefix}_${random}`;
};

// clamp is imported from './utils/helpers'

const getTimelineEnd = (clips) => {
  if (!clips.length) return 0;
  return Math.max(...clips.map((clip) => clip.timelineStart + clip.sourceDuration));
};

const getLaneEnd = (clips, type) => {
  const laneClips = clips.filter((clip) => clip.type === type);
  if (!laneClips.length) return 0;
  return Math.max(...laneClips.map((clip) => clip.timelineStart + clip.sourceDuration));
};

const compactClips = (clips) => {
  let cursor = 0;

  return [...clips]
    .sort((a, b) => a.timelineStart - b.timelineStart)
    .map((clip) => {
      const nextClip = {
        ...clip,
        timelineStart: cursor,
      };

      cursor += clip.sourceDuration;

      return nextClip;
    });
};

const useStore = create((set, get) => ({
  // === Media Library ===
  files: [],
  activeFileId: null,
  activeFile: null,
  selectedFileIds: [],

  // === Timeline Clips ===
  clips: [],
  activeClipId: null,

  // === Video Preview ===
  videoUrl: null,
  videoDuration: 0,
  currentTime: 0,

  // === Legacy / Active Clip Mirror ===
  // Эти поля теперь отражают activeClip.
  // Оставляем их, чтобы EditingControls и export не развалились.
  trimStart: 0,
  trimDuration: 0,
  clipStart: 0,

  // === Editing Controls ===
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
  currentJob: null,

  // === Error ===
  error: null,

  // === Helpers ===
  getActiveClip: () => {
    const state = get();
    return state.clips.find((clip) => clip.id === state.activeClipId) || null;
  },

  getFileById: (fileId) => {
    return get().files.find((file) => file.id === fileId) || null;
  },

  getTimelineDuration: () => getTimelineEnd(get().clips),

  getClipAtTime: (timelineTime) => {
    const time = Math.max(0, Number(timelineTime) || 0);
    return get().clips.find((clip) => (
      time >= clip.timelineStart
      && time < clip.timelineStart + clip.sourceDuration
    )) || null;
  },

  syncActiveClipMirror: (clipId) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === clipId);

    if (!clip) {
      debugWarn('store.syncActiveClipMirror', 'clip missing, clearing mirror', { clipId });
      set({
        activeClipId: null,
        trimStart: 0,
        trimDuration: 0,
        clipStart: 0,
      });
      return;
    }

    const file = state.files.find((item) => item.id === clip.fileId);

    set({
      activeClipId: clip.id,
      activeFileId: file?.id || null,
      activeFile: file || null,
      videoUrl: file?.localUrl || null,
      videoDuration: file?.duration || 0,
      trimStart: clip.sourceStart,
      trimDuration: clip.sourceDuration,
      clipStart: clip.timelineStart,
      jobId: null,
      jobStatus: null,
      jobProgress: 0,
      jobError: null,
      downloadReady: false,
      currentJob: null,
    });
  },

  // === Base Actions ===
  setError: (error) => {
    debugError('store.setError', 'set', { error });
    set({ error });
  },
  clearError: () => {
    debugLog('store.clearError', 'clearing');
    set({ error: null });
  },

  stopPolling: () => {
    debugLog('store.stopPolling', 'requested');
    if (activePollInterval) {
      clearTimeout(activePollInterval);
      activePollInterval = null;
    }
  },

  setCurrentTime: (t) => {
    const nextTime = Math.max(0, Number(t) || 0);
    const timelineDuration = getTimelineEnd(get().clips);
    const currentTime = get().currentTime;
    const clampedTime = timelineDuration > 0
      ? Math.min(nextTime, timelineDuration)
      : nextTime;

    if (Math.abs(clampedTime - currentTime) < 0.01) {
      return;
    }

    set({
      currentTime: clampedTime,
    });
  },

  setVideoDuration: (duration) => {
    const state = get();
    debugLog('store.setVideoDuration', 'requested', {
      duration,
      activeFileId: state.activeFileId,
    });

    set({
      videoDuration: duration,
      files: state.files.map((file) => (
        file.id === state.activeFileId
          ? { ...file, duration }
          : file
      )),
    });

    const activeClip = get().getActiveClip();

    if (activeClip && activeClip.sourceDuration <= 0) {
      get().updateClip(activeClip.id, {
        sourceDuration: duration,
      });
    }
  },

  setTrimStart: (value) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === state.activeClipId);
    if (!clip) return;

    const file = state.files.find((item) => item.id === clip.fileId);
    const fileDuration = file?.duration || state.videoDuration || 0;

    const oldEnd = clip.sourceStart + clip.sourceDuration;
    const nextSourceStart = clamp(Number(value) || 0, 0, Math.max(0, fileDuration - MIN_CLIP_DURATION));
    const nextSourceDuration = clamp(
      oldEnd - nextSourceStart,
      MIN_CLIP_DURATION,
      Math.max(MIN_CLIP_DURATION, fileDuration - nextSourceStart)
    );

    get().updateClip(clip.id, {
      sourceStart: nextSourceStart,
      sourceDuration: nextSourceDuration,
    });
  },

  setTrimDuration: (value) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === state.activeClipId);
    if (!clip) return;

    const file = state.files.find((item) => item.id === clip.fileId);
    const fileDuration = file?.duration || state.videoDuration || 0;

    const maxDuration = Math.max(MIN_CLIP_DURATION, fileDuration - clip.sourceStart);
    const nextDuration = clamp(Number(value) || MIN_CLIP_DURATION, MIN_CLIP_DURATION, maxDuration);

    get().updateClip(clip.id, {
      sourceDuration: nextDuration,
    });
  },

  setClipStart: (value) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === state.activeClipId);
    if (!clip) return;

    get().updateClip(clip.id, {
      timelineStart: Math.max(0, Number(value) || 0),
    });
  },

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

  // === Upload ===
  handleUpload: async (file) => {
    debugLog('store.handleUpload', 'started', {
      name: file?.name,
      size: file?.size,
      type: file?.type,
    });
    set({ isUploading: true, uploadProgress: 0, error: null });

    try {
      const result = await uploadFile(file, (pct) => {
        set({ uploadProgress: pct });
      });
      debugLog('store.handleUpload', 'upload API response', result);

      const metadataUrl = URL.createObjectURL(file);
      debugLog('store.handleUpload', 'metadata URL created', { metadataUrl });

      const dimensions = await new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        let settled = false;

        const cleanup = () => {
          vid.onloadedmetadata = null;
          vid.onerror = null;
          URL.revokeObjectURL(metadataUrl);
          vid.src = '';
        };

        vid.onloadedmetadata = () => {
          if (settled) return;
          settled = true;
          debugLog('store.handleUpload', 'metadata probe loaded', {
            width: vid.videoWidth,
            height: vid.videoHeight,
          });
          resolve({ width: vid.videoWidth, height: vid.videoHeight });
          cleanup();
        };

        vid.onerror = () => {
          if (settled) return;
          settled = true;
          debugWarn('store.handleUpload', 'metadata probe failed');
          resolve({ width: 0, height: 0 });
          cleanup();
        };

        vid.src = metadataUrl;
      });

      const localUrl = URL.createObjectURL(file);
      debugLog('store.handleUpload', 'playback URL created', { localUrl });

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
        waveform: [],
      };

      set((state) => ({
        files: [...state.files, fileEntry],
        isUploading: false,
        uploadProgress: 100,
      }));
      debugLog('store.handleUpload', 'file entry stored', fileEntry);

      get().selectFile(fileEntry.id);

      if (fileEntry.hasAudio) {
        debugLog('store.handleUpload', 'waveform generation queued', { fileId: fileEntry.id });
        void (async () => {
          let waveform = [];

          try {
            const response = await getFileWaveform(fileEntry.id, 160);
            waveform = Array.isArray(response?.bars) ? response.bars : [];
          } catch (error) {
            debugWarn('store.handleUpload', 'server waveform failed, falling back to browser decode', {
              fileId: fileEntry.id,
              message: error?.message || 'waveform fetch failed',
            });
            waveform = await generateWaveformPeaks(localUrl, 160, fileEntry.fileSize);
          }

          debugLog('store.handleUpload', 'waveform generated', {
            fileId: fileEntry.id,
            bars: waveform.length,
          });

          set((state) => ({
            files: state.files.map((item) => (
              item.id === fileEntry.id
                ? { ...item, waveform }
                : item
            )),
          }));
        })();
      }

      debugLog('store.handleUpload', 'completed', { fileId: fileEntry.id });
      return fileEntry;
    } catch (err) {
      debugError('store.handleUpload', 'failed', {
        message: err.response?.data?.error || err.message || 'Upload failed',
      });
      set({
        isUploading: false,
        error: err.response?.data?.error || err.message || 'Upload failed',
      });

      return null;
    }
  },

  // === Selection ===
  selectFile: (fileId) => {
    const state = get();
    const file = state.files.find((item) => item.id === fileId);
    debugLog('store.selectFile', 'requested', {
      fileId,
      found: !!file,
      clipCount: state.clips.length,
    });
    if (!file) return;

    let clip = state.clips.find((item) => item.fileId === fileId);

    if (!clip) {
      debugLog('store.selectFile', 'creating clip for file', {
        fileId: file.id,
        fileName: file.name,
      });
      clip = {
        id: createId('clip'),
        fileId: file.id,
        name: file.name,
        type: file.hasAudio && !file.hasVideo ? 'audio' : 'video',
        timelineStart: getLaneEnd(state.clips, file.hasAudio && !file.hasVideo ? 'audio' : 'video'),
        sourceStart: 0,
        sourceDuration: file.duration || 0,
        muted: false,
        volume: 1,
      };

      set((current) => ({
        clips: [...current.clips, clip],
      }));
    }

    debugLog('store.selectFile', 'activating clip', {
      clipId: clip.id,
      timelineStart: clip.timelineStart,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
    });
    set({ currentTime: clip.timelineStart });
    get().selectClip(clip.id);
  },

  selectClip: (clipId) => {
    debugLog('store.selectClip', 'requested', { clipId });
    get().syncActiveClipMirror(clipId);
  },

  updateClip: (clipId, patch) => {
    set((state) => {
      const clips = state.clips.map((clip) => {
        if (clip.id !== clipId) return clip;

        return {
          ...clip,
          ...patch,
          sourceStart: patch.sourceStart !== undefined
            ? Math.max(0, patch.sourceStart)
            : clip.sourceStart,
          sourceDuration: patch.sourceDuration !== undefined
            ? Math.max(MIN_CLIP_DURATION, patch.sourceDuration)
            : clip.sourceDuration,
          timelineStart: patch.timelineStart !== undefined
            ? Math.max(0, patch.timelineStart)
            : clip.timelineStart,
        };
      });

      const activeClip = clips.find((clip) => clip.id === state.activeClipId);

      return {
        clips,
        ...(clipId === state.activeClipId && activeClip
          ? {
              trimStart: activeClip.sourceStart,
              trimDuration: activeClip.sourceDuration,
              clipStart: activeClip.timelineStart,
        }
          : {}),
      };
    });
  },

  splitActiveClip: () => {
    const state = get();
    const clip = state.clips.find((item) => item.id === state.activeClipId);
    if (!clip) return;

    const splitTime = Math.max(0, Number(state.currentTime) || 0);
    const clipStart = clip.timelineStart;
    const clipEnd = clip.timelineStart + clip.sourceDuration;

    if (splitTime <= clipStart + MIN_CLIP_DURATION || splitTime >= clipEnd - MIN_CLIP_DURATION) {
      return;
    }

    const leftDuration = splitTime - clipStart;
    const rightDuration = clipEnd - splitTime;
    if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) {
      return;
    }

    const rightClipId = createId('clip');
    const leftClip = {
      ...clip,
      sourceDuration: leftDuration,
    };
    const rightClip = {
      ...clip,
      id: rightClipId,
      sourceStart: clip.sourceStart + leftDuration,
      sourceDuration: rightDuration,
      timelineStart: splitTime,
      name: clip.name,
    };

    set((current) => ({
      clips: current.clips.flatMap((item) => {
        if (item.id !== clip.id) return [item];
        return [leftClip, rightClip];
      }),
      activeClipId: rightClipId,
      trimStart: rightClip.sourceStart,
      trimDuration: rightClip.sourceDuration,
      clipStart: rightClip.timelineStart,
    }));

    get().syncActiveClipMirror(rightClipId);
  },

  deleteActiveClip: () => {
    const state = get();
    debugLog('store.deleteActiveClip', 'requested', {
      activeClipId: state.activeClipId,
      clipCount: state.clips.length,
      currentTime: state.currentTime,
    });
    if (!state.activeClipId) return;

    const remaining = state.clips.filter((clip) => clip.id !== state.activeClipId);
    const nextClip = remaining.find((clip) => clip.timelineStart >= state.currentTime)
      || remaining[0]
      || null;

    set({
      clips: remaining,
      activeClipId: nextClip?.id || null,
    });
    debugLog('store.deleteActiveClip', 'updated', {
      remainingCount: remaining.length,
      nextClipId: nextClip?.id || null,
    });

    if (nextClip) {
      set({ currentTime: nextClip.timelineStart });
      get().syncActiveClipMirror(nextClip.id);
    } else {
      set({
        activeFileId: null,
        activeFile: null,
        videoUrl: null,
        videoDuration: 0,
        trimStart: 0,
        trimDuration: 0,
        clipStart: 0,
      });
    }
  },

  moveActiveClipLeft: () => {
    const state = get();
    debugLog('store.moveActiveClipLeft', 'requested', {
      activeClipId: state.activeClipId,
      clipCount: state.clips.length,
    });
    if (!state.activeClipId) return;

    const ordered = [...state.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const index = ordered.findIndex((clip) => clip.id === state.activeClipId);

    if (index <= 0) return;

    // Immutable swap — never mutate objects still referenced in the store.
    const leftStart = ordered[index - 1].timelineStart;
    const currentStart = ordered[index].timelineStart;
    const newOrdered = ordered.map((clip, i) => {
      if (i === index - 1) return { ...clip, timelineStart: currentStart };
      if (i === index)     return { ...clip, timelineStart: leftStart };
      return clip;
    });

    set({ clips: newOrdered });
    debugLog('store.moveActiveClipLeft', 'swapped', {
      ordered: newOrdered.map((clip) => ({ id: clip.id, timelineStart: clip.timelineStart })),
    });

    set({ currentTime: newOrdered[index].timelineStart });
    get().syncActiveClipMirror(state.activeClipId);
  },

  moveActiveClipRight: () => {
    const state = get();
    debugLog('store.moveActiveClipRight', 'requested', {
      activeClipId: state.activeClipId,
      clipCount: state.clips.length,
    });
    if (!state.activeClipId) return;

    const ordered = [...state.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const index = ordered.findIndex((clip) => clip.id === state.activeClipId);

    if (index < 0 || index >= ordered.length - 1) return;

    // Immutable swap — never mutate objects still referenced in the store.
    const currentStart = ordered[index].timelineStart;
    const rightStart = ordered[index + 1].timelineStart;
    const newOrdered = ordered.map((clip, i) => {
      if (i === index)     return { ...clip, timelineStart: rightStart };
      if (i === index + 1) return { ...clip, timelineStart: currentStart };
      return clip;
    });

    set({ clips: newOrdered });
    debugLog('store.moveActiveClipRight', 'swapped', {
      ordered: newOrdered.map((clip) => ({ id: clip.id, timelineStart: clip.timelineStart })),
    });

    set({ currentTime: newOrdered[index].timelineStart });
    get().syncActiveClipMirror(state.activeClipId);
  },

  compactTimeline: () => {
    debugLog('store.compactTimeline', 'requested', {
      clipCount: get().clips.length,
    });
    const compacted = compactClips(get().clips);

    set({
      clips: compacted,
    });

    const activeClipId = get().activeClipId;
    if (activeClipId) {
      get().syncActiveClipMirror(activeClipId);
    }
  },

  toggleSelection: (fileId) => set((state) => ({
    selectedFileIds: state.selectedFileIds.includes(fileId)
      ? state.selectedFileIds.filter((id) => id !== fileId)
      : [...state.selectedFileIds, fileId],
  })),

  // === Export ===
  handleExport: async () => {
    const state = get();
    const audioOnly = isAudioOnlyFormat(state.outputFormat);
    debugLog('store.handleExport', 'requested', {
      activeFileId: state.activeFileId,
      activeClipId: state.activeClipId,
      clipCount: state.clips.length,
      outputFormat: state.outputFormat,
    });

    if (!state.clips.length || !state.activeFileId) {
      set({ error: 'No file selected' });
      return;
    }

    get().stopPolling();

    set({
      isExporting: true,
      jobProgress: 0,
      jobStatus: 'pending',
      jobError: null,
      downloadReady: false,
      currentJob: null,
      error: null,
    });

    try {
      const payload = {
        output_format: state.outputFormat,
        remove_audio: audioOnly ? false : state.removeAudio,
        mode: 'fast',
        audio_bitrate: state.audioBitrate ? state.audioBitrate.toString() : undefined,
        volume: state.volume !== 1.0 ? state.volume : undefined,
        clips: [...state.clips]
          .sort((a, b) => a.timelineStart - b.timelineStart)
          .map((clip) => ({
            file_id: clip.fileId,
            source_start: clip.sourceStart,
            duration: clip.sourceDuration,
          })),
      };

      if (!audioOnly) {
        Object.assign(payload, {
          video_codec: state.videoCodec,
          audio_codec: state.audioCodec,
          preset: state.preset,
          crf: state.crf,
          fast_start: state.fastStart,
          resize_width: state.resizeWidth ? parseInt(state.resizeWidth, 10) : undefined,
          resize_height: state.resizeHeight ? parseInt(state.resizeHeight, 10) : undefined,
          keep_aspect: state.resizeWidth || state.resizeHeight ? state.keepAspect : undefined,
          video_bitrate: state.videoBitrate ? state.videoBitrate.toString() : undefined,
          brightness: state.brightness !== 0 ? state.brightness : undefined,
          contrast: state.contrast !== 1.0 ? state.contrast : undefined,
        });
      }

      const result = await startTimelineExport(payload);

      set({
        jobId: result.job_id,
        jobStatus: result.status,
        currentJob: result,
      });
      debugLog('store.handleExport', 'job started', result);

      get().pollJob(result.job_id);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Export failed';
      debugError('store.handleExport', 'failed', { message: errorMsg });

      set({
        isExporting: false,
        jobError: errorMsg,
        currentJob: null,
        error: errorMsg,
      });
    }
  },

  handleMerge: async () => {
    const state = get();
    const audioOnly = isAudioOnlyFormat(state.outputFormat);
    debugLog('store.handleMerge', 'requested', {
      selectedFileIds: state.selectedFileIds,
      outputFormat: state.outputFormat,
    });

    if (state.selectedFileIds.length < 2) {
      set({ error: 'Select at least 2 files to merge' });
      return;
    }

    if (audioOnly) {
      set({ error: `Merge does not support audio-only format: ${state.outputFormat}` });
      return;
    }

    get().stopPolling();

    set({
      isExporting: true,
      jobProgress: 0,
      jobStatus: 'pending',
      jobError: null,
      downloadReady: false,
      currentJob: null,
      error: null,
    });

    const payload = {
      file_ids: state.selectedFileIds,
      output_format: state.outputFormat,
    };

    try {
      const result = await startMerge(payload);

      set({
        jobId: result.job_id,
        jobStatus: result.status,
        currentJob: result,
      });
      debugLog('store.handleMerge', 'job started', result);

      get().pollJob(result.job_id);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Merge failed';

      set({
        isExporting: false,
        jobError: errorMsg,
        currentJob: null,
        error: errorMsg,
      });
    }
  },

  pollJob: (jobId) => {
    if (activePollInterval) {
      clearTimeout(activePollInterval);
      activePollInterval = null;
    }
    debugLog('store.pollJob', 'started', { jobId });

    let networkFailures = 0;
    const MAX_FAILURES = 3;

    // Recursive setTimeout — the next request fires only after the previous
    // one completes, so requests never pile up if the server is slow.
    const poll = async () => {
      try {
        const job = await getJobStatus(jobId);
        debugLog('store.pollJob', 'status update', job);
        networkFailures = 0;

        const normalizedProgress = (() => {
          const raw = Number(job.progress) || 0;
          if (raw <= 1) return Math.max(0, Math.min(raw, 1));
          return Math.max(0, Math.min(raw / 100, 1));
        })();

        set({ jobStatus: job.status, jobProgress: normalizedProgress, currentJob: job });

        if (job.status === 'completed') {
          activePollInterval = null;
          set({ isExporting: false, downloadReady: true, jobProgress: 1, currentJob: job });
        } else if (job.status === 'failed') {
          activePollInterval = null;
          const errorMsg = job.error || 'Conversion failed';
          set({ isExporting: false, jobError: errorMsg, error: errorMsg, currentJob: job });
        } else {
          activePollInterval = setTimeout(poll, 900);
        }
      } catch {
        networkFailures += 1;
        debugWarn('store.pollJob', 'poll failure', { jobId, networkFailures });
        if (networkFailures >= MAX_FAILURES) {
          activePollInterval = null;
          set({
            isExporting: false,
            jobError: 'Lost connection to server',
            error: 'Lost connection to server',
          });
        } else {
          activePollInterval = setTimeout(poll, 1200);
        }
      }
    };

    void poll();
  },

  cancelCurrentJob: async () => {
    const { jobId, isExporting } = get();
    if (!jobId || !isExporting) return;

    try {
      await cancelJob(jobId);
      get().stopPolling();
      set((state) => ({
        isExporting: false,
        jobStatus: 'canceled',
        jobError: null,
        currentJob: state.currentJob
          ? { ...state.currentJob, status: 'canceled', stage: 'canceled' }
          : null,
        error: null,
      }));
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Cancel failed';
      set({ error: errorMsg, jobError: errorMsg });
    }
  },

  getDownloadLink: () => {
    const { jobId } = get();
    if (!jobId) return null;

    return getDownloadUrl(jobId);
  },

  removeFile: async (fileId) => {
    debugLog('store.removeFile', 'requested', { fileId });
    try {
      await deleteFile(fileId);
      debugLog('store.removeFile', 'server delete complete', { fileId });
    } catch (err) {
      debugError('store.removeFile', 'server delete failed', {
        fileId,
        message: err.response?.data?.error || err.message || 'Delete failed',
      });
      console.error('Failed to delete on server', err);
    }

    set((state) => {
      const fileToRemove = state.files.find((file) => file.id === fileId);

      if (fileToRemove?.localUrl) {
        URL.revokeObjectURL(fileToRemove.localUrl);
      }

      const newFiles = state.files.filter((file) => file.id !== fileId);
      const newSelected = state.selectedFileIds.filter((id) => id !== fileId);
      const newClips = state.clips.filter((clip) => clip.fileId !== fileId);

      const activeClipStillExists = newClips.some((clip) => clip.id === state.activeClipId);
      const nextClip = activeClipStillExists
        ? newClips.find((clip) => clip.id === state.activeClipId)
        : newClips[0];

      const nextFile = nextClip
        ? newFiles.find((file) => file.id === nextClip.fileId)
        : null;

      return {
        files: newFiles,
        selectedFileIds: newSelected,
        clips: newClips,
        activeClipId: nextClip?.id || null,
        activeFileId: nextFile?.id || null,
        activeFile: nextFile || null,
        videoUrl: nextFile?.localUrl || null,
        videoDuration: nextFile?.duration || 0,
        trimStart: nextClip?.sourceStart || 0,
        trimDuration: nextClip?.sourceDuration || 0,
        clipStart: nextClip?.timelineStart || 0,
        jobId: null,
        jobStatus: null,
        jobProgress: 0,
        jobError: null,
        downloadReady: false,
        currentJob: null,
      };
    });
  },
}));

export default useStore;
