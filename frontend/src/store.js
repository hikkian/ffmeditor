import { create } from 'zustand';
import { uploadFile, startConvert, startMerge, startTimelineExport, getJobStatus, getDownloadUrl, deleteFile } from './api';
import { generateWaveformPeaks } from './utils/waveform';
import { debugLog, debugWarn, debugError } from './utils/debug';
import { clamp } from './utils/helpers';

let activePollInterval = null;

const MIN_CLIP_DURATION = 0.5;

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
    debugLog('store.syncActiveClipMirror', 'requested', {
      clipId,
      clipFound: !!clip,
      clipCount: state.clips.length,
    });

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
    debugLog('store.syncActiveClipMirror', 'resolved clip/file', {
      clipId: clip.id,
      fileId: file?.id || null,
      fileName: file?.name || null,
      timelineStart: clip.timelineStart,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
    });

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
    debugLog('store.setCurrentTime', 'requested', {
      nextTime,
      timelineDuration,
      clipCount: get().clips.length,
    });

    set({
      currentTime: timelineDuration > 0
        ? Math.min(nextTime, timelineDuration)
        : nextTime,
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

        const cleanup = () => {
          URL.revokeObjectURL(metadataUrl);
          vid.src = '';
        };

        vid.onloadedmetadata = () => {
          debugLog('store.handleUpload', 'metadata probe loaded', {
            width: vid.videoWidth,
            height: vid.videoHeight,
          });
          resolve({
            width: vid.videoWidth,
            height: vid.videoHeight,
          });
          cleanup();
        };

        vid.onerror = () => {
          debugWarn('store.handleUpload', 'metadata probe failed');
          resolve({
            width: 0,
            height: 0,
          });
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
        void generateWaveformPeaks(localUrl, 160, fileEntry.fileSize).then((waveform) => {
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
        });
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
        timelineStart: getTimelineEnd(state.clips),
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
    debugLog('store.updateClip', 'requested', { clipId, patch });
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

  splitActiveClip: (atTime = null) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === state.activeClipId);
    debugLog('store.splitActiveClip', 'requested', {
      atTime,
      currentTime: state.currentTime,
      activeClipId: state.activeClipId,
      clipFound: !!clip,
    });

    if (!clip) {
      set({ error: 'No clip selected' });
      return;
    }

    const timelineTime = atTime === null ? state.currentTime : atTime;
    const splitAt = timelineTime - clip.timelineStart;

    if (splitAt <= MIN_CLIP_DURATION || splitAt >= clip.sourceDuration - MIN_CLIP_DURATION) {
      debugWarn('store.splitActiveClip', 'rejected', {
        splitAt,
        sourceDuration: clip.sourceDuration,
      });
      set({ error: 'Move playhead inside the clip before splitting' });
      return;
    }

    const leftClip = {
      ...clip,
      sourceDuration: splitAt,
    };

    const rightClip = {
      ...clip,
      id: createId('clip'),
      name: `${clip.name} part`,
      timelineStart: clip.timelineStart + splitAt,
      sourceStart: clip.sourceStart + splitAt,
      sourceDuration: clip.sourceDuration - splitAt,
    };

    set((current) => ({
      clips: current.clips.flatMap((item) => (
        item.id === clip.id
          ? [leftClip, rightClip]
          : [item]
      )),
      activeClipId: rightClip.id,
    }));
    debugLog('store.splitActiveClip', 'completed', { leftClip, rightClip });

    set({ currentTime: rightClip.timelineStart });
    get().syncActiveClipMirror(rightClip.id);
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
    const isTimelineExport = state.clips.length > 1;
    debugLog('store.handleExport', 'requested', {
      isTimelineExport,
      activeFileId: state.activeFileId,
      activeClipId: state.activeClipId,
      clipCount: state.clips.length,
      outputFormat: state.outputFormat,
    });

    if (!isTimelineExport && !state.activeFileId) {
      set({ error: 'No file selected' });
      return;
    }

    const activeClip = state.clips.find((clip) => clip.id === state.activeClipId);

    if (!isTimelineExport && !activeClip) {
      set({ error: 'No clip selected' });
      return;
    }

    get().stopPolling();

    set({
      isExporting: true,
      jobProgress: 0,
      jobStatus: 'pending',
      jobError: null,
      downloadReady: false,
      error: null,
    });

    try {
      const result = isTimelineExport
        ? await startTimelineExport({
            output_format: state.outputFormat,
            video_codec: state.videoCodec,
            audio_codec: state.audioCodec,
            preset: state.preset,
            crf: state.crf,
            fast_start: state.fastStart,
            remove_audio: state.removeAudio,
            resize_width: state.resizeWidth ? parseInt(state.resizeWidth, 10) : undefined,
            resize_height: state.resizeHeight ? parseInt(state.resizeHeight, 10) : undefined,
            keep_aspect: state.resizeWidth || state.resizeHeight ? state.keepAspect : undefined,
            video_bitrate: state.videoBitrate ? state.videoBitrate.toString() : undefined,
            audio_bitrate: state.audioBitrate ? state.audioBitrate.toString() : undefined,
            brightness: state.brightness !== 0 ? state.brightness : undefined,
            contrast: state.contrast !== 1.0 ? state.contrast : undefined,
            volume: state.volume !== 1.0 ? state.volume : undefined,
            clips: [...state.clips]
              .sort((a, b) => a.timelineStart - b.timelineStart)
              .map((clip) => ({
                file_id: clip.fileId,
                source_start: clip.sourceStart,
                duration: clip.sourceDuration,
              })),
          })
        : await startConvert({
            file_id: activeClip.fileId,
            output_format: state.outputFormat,
            video_codec: state.videoCodec,
            audio_codec: state.audioCodec,
            remove_audio: state.removeAudio,
            preset: state.preset,
            crf: state.crf,
            fast_start: state.fastStart,
            trim_start: activeClip.sourceStart > 0 ? activeClip.sourceStart : undefined,
            trim_duration: activeClip.sourceDuration > 0 ? activeClip.sourceDuration : undefined,
            resize_width: state.resizeWidth ? parseInt(state.resizeWidth, 10) : undefined,
            resize_height: state.resizeHeight ? parseInt(state.resizeHeight, 10) : undefined,
            keep_aspect: state.resizeWidth || state.resizeHeight ? state.keepAspect : undefined,
            video_bitrate: state.videoBitrate ? state.videoBitrate.toString() : undefined,
            audio_bitrate: state.audioBitrate ? state.audioBitrate.toString() : undefined,
            brightness: state.brightness !== 0 ? state.brightness : undefined,
            contrast: state.contrast !== 1.0 ? state.contrast : undefined,
            volume: state.volume !== 1.0 ? state.volume : undefined,
          });

      set({
        jobId: result.job_id,
        jobStatus: result.status,
      });
      debugLog('store.handleExport', 'job started', result);

      get().pollJob(result.job_id);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Export failed';
      debugError('store.handleExport', 'failed', { message: errorMsg });

      set({
        isExporting: false,
        jobError: errorMsg,
        error: errorMsg,
      });
    }
  },

  handleMerge: async () => {
    const state = get();
    debugLog('store.handleMerge', 'requested', {
      selectedFileIds: state.selectedFileIds,
    });

    if (state.selectedFileIds.length < 2) {
      set({ error: 'Select at least 2 files to merge' });
      return;
    }

    get().stopPolling();

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

      set({
        jobId: result.job_id,
        jobStatus: result.status,
      });
      debugLog('store.handleMerge', 'job started', result);

      get().pollJob(result.job_id);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Merge failed';

      set({
        isExporting: false,
        jobError: errorMsg,
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

        set({ jobStatus: job.status, jobProgress: normalizedProgress });

        if (job.status === 'completed') {
          activePollInterval = null;
          set({ isExporting: false, downloadReady: true, jobProgress: 1 });
        } else if (job.status === 'failed') {
          activePollInterval = null;
          const errorMsg = job.error || 'Conversion failed';
          set({ isExporting: false, jobError: errorMsg, error: errorMsg });
        } else {
          activePollInterval = setTimeout(poll, 2500);
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
          activePollInterval = setTimeout(poll, 2500);
        }
      }
    };

    activePollInterval = setTimeout(poll, 2500);
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
      };
    });
  },
}));

export default useStore;
