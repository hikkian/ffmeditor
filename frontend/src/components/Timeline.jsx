import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import useStore from '../store';
import { debugLog } from '../utils/debug';
import { clamp } from '../utils/helpers';

const MIN_CLIP_DURATION = 0.5;
const FALLBACK_WAVEFORM = Array.from({ length: 80 }, () => 20);

export default function Timeline() {
  const clips = useStore((s) => s.clips);
  const files = useStore((s) => s.files);
  const activeClipId = useStore((s) => s.activeClipId);
  const currentTime = useStore((s) => s.currentTime);
  const videoDuration = useStore((s) => s.videoDuration);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const getClipAtTime = useStore((s) => s.getClipAtTime);

  const selectClip = useStore((s) => s.selectClip);
  const updateClip = useStore((s) => s.updateClip);
  const splitActiveClip = useStore((s) => s.splitActiveClip);
  const deleteActiveClip = useStore((s) => s.deleteActiveClip);
  const moveActiveClipLeft = useStore((s) => s.moveActiveClipLeft);
  const moveActiveClipRight = useStore((s) => s.moveActiveClipRight);
  const compactTimeline = useStore((s) => s.compactTimeline);

  const trackRef = useRef(null);

  const [dragging, setDragging] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartValues, setDragStartValues] = useState(null);

  const activeClip = clips.find((clip) => clip.id === activeClipId) || null;

  const timelineDuration = useMemo(() => {
    if (!clips.length) return videoDuration || 0;

    const end = Math.max(
      ...clips.map((clip) => clip.timelineStart + clip.sourceDuration),
      videoDuration || 0
    );

    return Math.max(end, 1);
  }, [clips, videoDuration]);

  const playheadTime = clamp(currentTime, 0, timelineDuration);

  const playheadPct = timelineDuration > 0
    ? (playheadTime / timelineDuration) * 100
    : 0;

  const formatTime = (secs) => {
    if (!secs || Number.isNaN(secs)) return '0:00.0';

    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);

    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const getFileName = (fileId) => {
    const file = files.find((item) => item.id === fileId);
    return file?.name || 'Unknown media';
  };

  const getFileDuration = (fileId) => {
    const file = files.find((item) => item.id === fileId);
    return file?.duration || 0;
  };

  const seekTimelineToClientX = useCallback((clientX, { selectHitClip = true } = {}) => {
    const track = trackRef.current;
    if (!track || !timelineDuration) return;

    const rect = track.getBoundingClientRect();
    const nextTime = clamp(((clientX - rect.left) / rect.width) * timelineDuration, 0, timelineDuration);
    debugLog('Timeline.seekTimelineToClientX', 'scrub', {
      clientX,
      nextTime,
      selectHitClip,
      timelineDuration,
    });
    setCurrentTime(nextTime);

    if (selectHitClip) {
      const hitClip = getClipAtTime(nextTime);
      if (hitClip && hitClip.id !== activeClipId) {
        selectClip(hitClip.id);
      }
    }
  }, [activeClipId, getClipAtTime, selectClip, setCurrentTime, timelineDuration]);

  const startPlayheadDrag = useCallback((clientX) => {
    debugLog('Timeline.startPlayheadDrag', 'start', { clientX });
    setDragging('playhead');
    setDragStartX(clientX);
  }, []);

  const markers = useMemo(() => {
    if (!timelineDuration) return [];

    const count = Math.min(Math.floor(timelineDuration / 5) + 1, 20);
    const step = timelineDuration / count;
    const arr = [];

    for (let i = 0; i <= count; i++) {
      arr.push(i * step);
    }

    return arr;
  }, [timelineDuration]);

  const handleMouseDown = (e, type, clip) => {
    e.preventDefault();
    e.stopPropagation();
    debugLog('Timeline.handleMouseDown', 'drag start', {
      type,
      clipId: clip.id,
      timelineStart: clip.timelineStart,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
      clientX: e.clientX,
    });

    selectClip(clip.id);

    setDragging(type);
    setDragStartX(e.clientX);
    setDragStartValues({
      clipId: clip.id,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
      timelineStart: clip.timelineStart,
      fileDuration: getFileDuration(clip.fileId),
    });
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      if (dragging === 'playhead') {
        debugLog('Timeline.handleMouseMove', 'drag playhead', {
          clientX: e.clientX,
        });
        seekTimelineToClientX(e.clientX);
        return;
      }

      if (!dragStartValues) return;

      const track = trackRef.current;
      if (!track || !timelineDuration) return;

      const rect = track.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX;
      const deltaPct = deltaX / rect.width;
      const deltaTime = deltaPct * timelineDuration;

      if (dragging === 'clip') {
        debugLog('Timeline.handleMouseMove', 'drag clip', {
          clipId: dragStartValues.clipId,
          deltaTime,
        });
        const nextTimelineStart = Math.max(
          0,
          dragStartValues.timelineStart + deltaTime
        );

        updateClip(dragStartValues.clipId, {
          timelineStart: nextTimelineStart,
        });

        return;
      }

      if (dragging === 'left') {
        debugLog('Timeline.handleMouseMove', 'trim left', {
          clipId: dragStartValues.clipId,
          deltaTime,
        });
        let delta = deltaTime;

        if (dragStartValues.sourceStart + delta < 0) {
          delta = -dragStartValues.sourceStart;
        }

        if (dragStartValues.sourceDuration - delta < MIN_CLIP_DURATION) {
          delta = dragStartValues.sourceDuration - MIN_CLIP_DURATION;
        }

        if (dragStartValues.timelineStart + delta < 0) {
          delta = -dragStartValues.timelineStart;
        }

        const nextSourceStart = dragStartValues.sourceStart + delta;
        const nextSourceDuration = dragStartValues.sourceDuration - delta;
        const nextTimelineStart = dragStartValues.timelineStart + delta;

        updateClip(dragStartValues.clipId, {
          sourceStart: nextSourceStart,
          sourceDuration: nextSourceDuration,
          timelineStart: nextTimelineStart,
        });

        return;
      }

      if (dragging === 'right') {
        const fileDuration = dragStartValues.fileDuration || 0;
        debugLog('Timeline.handleMouseMove', 'trim right', {
          clipId: dragStartValues.clipId,
          deltaTime,
          fileDuration,
        });

        let nextSourceDuration = dragStartValues.sourceDuration + deltaTime;

        nextSourceDuration = Math.max(MIN_CLIP_DURATION, nextSourceDuration);

        if (dragStartValues.sourceStart + nextSourceDuration > fileDuration) {
          nextSourceDuration = fileDuration - dragStartValues.sourceStart;
        }

        updateClip(dragStartValues.clipId, {
          sourceDuration: Math.max(MIN_CLIP_DURATION, nextSourceDuration),
        });
      }
    };

    const handleMouseUp = () => {
      debugLog('Timeline.handleMouseUp', 'stop drag', { dragging });
      setDragging(null);
      setDragStartValues(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dragging,
    dragStartX,
    dragStartValues,
    timelineDuration,
    updateClip,
    seekTimelineToClientX,
  ]);

  useEffect(() => {
    const clipAtTime = getClipAtTime(currentTime);
    debugLog('Timeline.currentTimeEffect', 'sync selection', {
      currentTime,
      activeClipId,
      clipAtTimeId: clipAtTime?.id || null,
    });
    if (clipAtTime && clipAtTime.id !== activeClipId) {
      selectClip(clipAtTime.id);
    }
  }, [currentTime, activeClipId, getClipAtTime, selectClip]);

  if (!clips.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25M3.375 19.5a1.125 1.125 0 01-1.125-1.125V5.625A1.125 1.125 0 013.375 4.5h17.25a1.125 1.125 0 011.125 1.125v12.75a1.125 1.125 0 01-1.125 1.125" />
          </svg>
          <span className="text-xs">Upload media to create timeline clips</span>
        </div>
      </div>
    );
  }

  const activeIndex = [...clips]
    .sort((a, b) => a.timelineStart - b.timelineStart)
    .findIndex((clip) => clip.id === activeClipId);

  const getWaveformBarsForClip = (clip) => {
    const file = files.find((item) => item.id === clip.fileId);
    const waveform = file?.waveform || [];

    if (!waveform.length) {
      return FALLBACK_WAVEFORM;
    }

    const totalDuration = file?.duration || clip.sourceDuration || waveform.length;
    if (totalDuration <= 0) {
      return waveform.slice(0, 80);
    }

    const startRatio = clamp(clip.sourceStart / totalDuration, 0, 1);
    const endRatio = clamp((clip.sourceStart + clip.sourceDuration) / totalDuration, 0, 1);

    let startIndex = Math.floor(startRatio * waveform.length);
    let endIndex = Math.ceil(endRatio * waveform.length);

    if (endIndex <= startIndex) {
      endIndex = Math.min(waveform.length, startIndex + 1);
    }

    return waveform.slice(startIndex, endIndex).slice(0, 80);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">Timeline</h2>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => splitActiveClip()}
            disabled={!activeClip}
            className="px-2 py-1 rounded text-[10px] font-medium bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            title="Split at playhead"
          >
            Split
          </button>

          <button
            type="button"
            onClick={moveActiveClipLeft}
            disabled={!activeClip || activeIndex <= 0}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            title="Move clip left"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            type="button"
            onClick={moveActiveClipRight}
            disabled={!activeClip || activeIndex >= clips.length - 1}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            title="Move clip right"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            type="button"
            onClick={compactTimeline}
            className="px-2 py-1 rounded text-[10px] font-medium bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
            title="Remove gaps between clips"
          >
            Compact
          </button>

          <button
            type="button"
            onClick={deleteActiveClip}
            disabled={!activeClip}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            title="Delete selected clip"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">CLIPS</span>
            <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{clips.length}</span>
          </div>

          {activeClip && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--color-text-muted)]">IN</span>
                <span className="text-[11px] font-mono text-[var(--color-success)]">
                  {formatTime(activeClip.sourceStart)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--color-text-muted)]">DUR</span>
                <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                  {formatTime(activeClip.sourceDuration)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="px-4 pt-2">
        <div
          className="relative h-5 border-b border-[var(--color-border)] cursor-ew-resize select-none"
          onMouseDown={(e) => {
            e.preventDefault();
            seekTimelineToClientX(e.clientX);
            startPlayheadDrag(e.clientX);
          }}
        >
          {markers.map((time, i) => {
            const pct = (time / timelineDuration) * 100;

            return (
              <div
                key={i}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: `${pct}%` }}
              >
                <div className="w-px h-2 bg-[var(--color-border-light)]" />
                <span className="text-[9px] text-[var(--color-text-muted)] font-mono mt-0.5">
                  {formatTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 px-4 py-3">
        <div
          ref={trackRef}
          className="relative h-16 bg-[var(--color-timeline-track)] rounded-lg overflow-hidden border border-[var(--color-border)] cursor-ew-resize select-none"
          onMouseDown={(e) => {
            seekTimelineToClientX(e.clientX);
            startPlayheadDrag(e.clientX);
          }}
        >
          {clips.map((clip) => {
            const isActive = clip.id === activeClipId;
            const waveformBars = getWaveformBarsForClip(clip);
            const pctStart = timelineDuration > 0
              ? (clip.timelineStart / timelineDuration) * 100
              : 0;
            const pctWidth = timelineDuration > 0
              ? (clip.sourceDuration / timelineDuration) * 100
              : 100;

            return (
              <div
                key={clip.id}
                className={`absolute top-1.5 h-[52px] cursor-grab active:cursor-grabbing rounded overflow-hidden select-none ${
                  isActive ? 'z-10' : 'z-0'
                }`}
                style={{
                  left: `${pctStart}%`,
                  width: `${pctWidth}%`,
                  minWidth: '32px',
                }}
                onMouseDown={(e) => handleMouseDown(e, 'clip', clip)}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentTime(clip.timelineStart);
                  selectClip(clip.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCurrentTime(clip.timelineStart);
                    selectClip(clip.id);
                  }
                }}
              >
                <div className={`absolute inset-0 border rounded ${
                  isActive
                    ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-elevated)]/80 border-[var(--color-border-light)] hover:border-[var(--color-text-muted)]'
                } transition-colors`} />

                <div
                  className="absolute left-0 top-0 w-2.5 h-full cursor-col-resize z-20 flex items-center justify-center group"
                  onMouseDown={(e) => handleMouseDown(e, 'left', clip)}
                  title="Trim left"
                >
                  <div className={`w-0.5 h-6 rounded-full transition-all group-hover:w-1 ${
                    isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-light)] group-hover:bg-[var(--color-text-muted)]'
                  }`} />
                </div>

                <div
                  className="absolute right-0 top-0 w-2.5 h-full cursor-col-resize z-20 flex items-center justify-center group"
                  onMouseDown={(e) => handleMouseDown(e, 'right', clip)}
                  title="Trim right"
                >
                  <div className={`w-0.5 h-6 rounded-full transition-all group-hover:w-1 ${
                    isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-light)] group-hover:bg-[var(--color-text-muted)]'
                  }`} />
                </div>

                <div className="absolute inset-x-2 top-[20px] bottom-1.5 flex items-end gap-px pointer-events-none opacity-30 overflow-hidden">
                  {waveformBars.map((height, i) => (
                    <div
                      key={i}
                      className="flex-1 min-w-0 rounded-sm bg-[var(--color-text-muted)]"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>

                <div className="absolute inset-x-3 top-1.5 pointer-events-none z-10">
                  <span className={`text-[10px] font-medium truncate block leading-tight ${
                    isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
                  }`}>
                    {getFileName(clip.fileId)}
                  </span>
                  <span className="text-[9px] font-mono text-[var(--color-text-muted)] block mt-0.5">
                    {formatTime(clip.sourceStart)}
                  </span>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className="absolute top-0 -translate-x-1/2 z-40 w-4 h-16 cursor-ew-resize focus:outline-none"
            style={{ left: `${clamp(playheadPct, 0, 100)}%` }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              seekTimelineToClientX(e.clientX, { selectHitClip: false });
              startPlayheadDrag(e.clientX);
            }}
            aria-label="Scrub timeline"
          >
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-3 h-3 bg-[#c93a3a] rotate-45 rounded-[1px] shadow-sm" />
            <div className="absolute left-1/2 -translate-x-1/2 top-1 w-[2px] h-16 bg-[#c93a3a] opacity-95" />
          </button>
        </div>
      </div>
    </div>
  );
}
