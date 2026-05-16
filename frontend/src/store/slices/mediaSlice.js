import { uploadFile, deleteFile } from '../../api';
import { generateWaveformPeaks } from '../../utils/waveform';
import { debugLog, debugWarn, debugError } from '../../utils/debug';
import { createId, getTimelineEnd } from '../utils';

export const createMediaSlice = (set, get) => ({
  // === Media Library ===
  files: [],
  activeFileId: null,
  activeFile: null,
  selectedFileIds: [],

  getFileById: (fileId) => {
    return get().files.find((file) => file.id === fileId) || null;
  },

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

  toggleSelection: (fileId) => set((state) => ({
    selectedFileIds: state.selectedFileIds.includes(fileId)
      ? state.selectedFileIds.filter((id) => id !== fileId)
      : [...state.selectedFileIds, fileId],
  })),

  handleDeleteFile: async (fileId) => {
    debugLog('store.handleDeleteFile', 'requested', { fileId });
    try {
      await deleteFile(fileId);
      
      set((state) => {
        const remainingFiles = state.files.filter((f) => f.id !== fileId);
        const remainingClips = state.clips.filter((c) => c.fileId !== fileId);
        
        let newActiveFileId = state.activeFileId;
        if (state.activeFileId === fileId) {
          newActiveFileId = remainingFiles.length > 0 ? remainingFiles[0].id : null;
        }

        return {
          files: remainingFiles,
          clips: remainingClips,
          selectedFileIds: state.selectedFileIds.filter((id) => id !== fileId),
          activeFileId: newActiveFileId,
          activeFile: remainingFiles.find(f => f.id === newActiveFileId) || null,
        };
      });

      const state = get();
      if (!state.clips.find(c => c.id === state.activeClipId)) {
        if (state.clips.length > 0) {
          get().selectClip(state.clips[0].id);
        } else {
          set({
            activeClipId: null,
            videoUrl: null,
            videoDuration: 0,
            trimStart: 0,
            trimDuration: 0,
            clipStart: 0,
          });
        }
      }
      debugLog('store.handleDeleteFile', 'completed', { fileId });
    } catch (err) {
      debugError('store.handleDeleteFile', 'failed', err);
      set({ error: err.response?.data?.error || err.message || 'Failed to delete file' });
    }
  },
});
