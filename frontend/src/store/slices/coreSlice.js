import { debugLog, debugError } from '../../utils/debug';
import { getTimelineEnd } from '../utils';

export const createCoreSlice = (set, get) => ({
  // === Video Preview ===
  videoUrl: null,
  videoDuration: 0,
  currentTime: 0,

  // === Error ===
  error: null,

  setError: (error) => {
    debugError('store.setError', 'set', { error });
    set({ error });
  },
  clearError: () => {
    debugLog('store.clearError', 'clearing');
    set({ error: null });
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
});
