/**
 * Shared utilities — avoid duplicating these across components.
 */

/** Clamp a value between min and max (inclusive). */
export const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/**
 * Format seconds as M:SS.t  (e.g. 1:05.3)
 * Returns '0:00.0' for falsy / NaN input.
 */
export function formatTime(secs) {
  if (!secs || Number.isNaN(secs)) return '0:00.0';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
