export const MIN_CLIP_DURATION = 0.5;

export const createId = (prefix) => {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return `${prefix}_${random}`;
};

export const getTimelineEnd = (clips) => {
  if (!clips.length) return 0;
  return Math.max(...clips.map((clip) => clip.timelineStart + clip.sourceDuration));
};

export const compactClips = (clips) => {
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
