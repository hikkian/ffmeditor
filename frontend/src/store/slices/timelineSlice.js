import { debugLog, debugWarn } from '../../utils/debug';
import { createId, getTimelineEnd, compactClips, MIN_CLIP_DURATION } from '../utils';
import { clamp } from '../../utils/helpers';

export const createTimelineSlice = (set, get) => ({
  // === Timeline Clips ===
  clips: [],
  activeClipId: null,

  // === Legacy / Active Clip Mirror ===
  trimStart: 0,
  trimDuration: 0,
  clipStart: 0,

  getActiveClip: () => {
    const state = get();
    return state.clips.find((clip) => clip.id === state.activeClipId) || null;
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
});
