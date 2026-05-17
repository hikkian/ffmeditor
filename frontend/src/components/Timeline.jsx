import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import useStore from '../store';
import { clamp } from '../utils/helpers';

const MIN_CLIP_DURATION = 0.5;

function fmt(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00.0';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${minutes}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

function getWaveformBars(file, clip) {
  if (!file) return null;
  const waveform = file.waveform;
  if (!waveform || !waveform.length) return null;

  const totalDuration = file.duration;
  if (!totalDuration || totalDuration <= 0) {
    return clip.sourceStart === 0 ? waveform.slice(0, 80) : null;
  }

  const startRatio = clamp(clip.sourceStart / totalDuration, 0, 1);
  const endRatio = clamp((clip.sourceStart + clip.sourceDuration) / totalDuration, 0, 1);

  let startIndex = Math.floor(startRatio * waveform.length);
  let endIndex = Math.ceil(endRatio * waveform.length);
  if (endIndex <= startIndex) endIndex = Math.min(waveform.length, startIndex + 1);

  const slice = waveform.slice(startIndex, endIndex);
  return slice.length ? slice : null;
}

function ToolButton({ onClick, title, disabled, danger, children }) {
  const [hovered, setHovered] = useState(false);
  const active = !disabled && hovered;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${active ? (danger ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.5)') : 'var(--color-border)'}`,
        background: active ? (danger ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)') : 'var(--color-bg-tertiary)',
        color: disabled ? 'var(--color-text-muted)' : active ? (danger ? '#ef4444' : 'var(--color-accent)') : 'var(--color-text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.12s',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function TrackBadge({ kind, label }) {
  const isAudio = kind === 'audio';
  const color = isAudio ? 'var(--color-orange)' : 'var(--color-accent)';

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        flex: 1,
        minHeight: 84,
        borderBottom: isAudio ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {isAudio ? (
        <svg className="w-3.5 h-3.5" style={{ color, opacity: 0.7 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" style={{ color, opacity: 0.7 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
        </svg>
      )}
      <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 3, letterSpacing: '0.05em' }}>{label}</span>
    </div>
  );
}

export default function Timeline() {
  const clips = useStore((s) => s.clips);
  const files = useStore((s) => s.files);
  const activeClipId = useStore((s) => s.activeClipId);
  const currentTime = useStore((s) => s.currentTime);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const getClipAtTime = useStore((s) => s.getClipAtTime);
  const selectClip = useStore((s) => s.selectClip);
  const updateClip = useStore((s) => s.updateClip);
  const deleteActiveClip = useStore((s) => s.deleteActiveClip);
  const moveActiveClipLeft = useStore((s) => s.moveActiveClipLeft);
  const moveActiveClipRight = useStore((s) => s.moveActiveClipRight);
  const compactTimeline = useStore((s) => s.compactTimeline);
  const splitActiveClip = useStore((s) => s.splitActiveClip);
  const trimStart = useStore((s) => s.trimStart);
  const trimDuration = useStore((s) => s.trimDuration);

  const trackRef = useRef(null);
  const scrollRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartValues, setDragStartValues] = useState(null);
  const [hoverTime, setHoverTime] = useState(null);

  const orderedClips = useMemo(
    () => [...clips].sort((a, b) => a.timelineStart - b.timelineStart),
    [clips]
  );
  const videoClips = useMemo(
    () => orderedClips.filter((clip) => clip.type !== 'audio'),
    [orderedClips]
  );
  const audioClips = useMemo(
    () => orderedClips.filter((clip) => clip.type === 'audio'),
    [orderedClips]
  );

  const totalDuration = useMemo(() => {
    if (!clips.length) return 0;
    return Math.max(...clips.map((clip) => clip.timelineStart + clip.sourceDuration), 1);
  }, [clips]);

  const activeClip = clips.find((clip) => clip.id === activeClipId) || null;
  const isFirst = orderedClips[0]?.id === activeClipId;
  const isLast = orderedClips[orderedClips.length - 1]?.id === activeClipId;
  const playheadPct = totalDuration > 0 ? clamp(currentTime / totalDuration, 0, 1) * 100 : 0;
  const trimEnd = trimStart + trimDuration;

  const zoomIn = useCallback(() => setZoom((value) => Math.min(16, +(value * 1.6).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((value) => Math.max(1, +(value / 1.6).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  const seekToClientX = useCallback((clientX, { selectHit = true } = {}) => {
    const track = trackRef.current;
    if (!track || !totalDuration) return;
    const rect = track.getBoundingClientRect();
    const nextTime = clamp(((clientX - rect.left) / rect.width) * totalDuration, 0, totalDuration);
    setCurrentTime(nextTime);
    if (selectHit) {
      const hit = getClipAtTime(nextTime);
      if (hit && hit.id !== activeClipId) selectClip(hit.id);
    }
  }, [activeClipId, getClipAtTime, selectClip, setCurrentTime, totalDuration]);

  const onRulerMouseDown = useCallback((e) => {
    e.preventDefault();
    seekToClientX(e.clientX, { selectHit: false });
    setDragging('playhead');
    setDragStartX(e.clientX);
  }, [seekToClientX]);

  const onTrackMouseDown = useCallback((e) => {
    if (e.target !== trackRef.current) return;
    e.preventDefault();
    seekToClientX(e.clientX);
    setDragging('playhead');
    setDragStartX(e.clientX);
  }, [seekToClientX]);

  const onPlayheadMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging('playhead');
    setDragStartX(e.clientX);
  }, []);

  const onClipMouseDown = useCallback((e, type, clip) => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id);
    if (type === 'clip') seekToClientX(e.clientX, { selectHit: false });
    setDragging(type);
    setDragStartX(e.clientX);
    const file = files.find((item) => item.id === clip.fileId);
    setDragStartValues({
      clipId: clip.id,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
      timelineStart: clip.timelineStart,
      fileDuration: file?.duration || 0,
    });
  }, [files, seekToClientX, selectClip]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      if (dragging === 'playhead') {
        seekToClientX(e.clientX);
        return;
      }

      if (!dragStartValues) return;
      const track = trackRef.current;
      if (!track || !totalDuration) return;
      const rect = track.getBoundingClientRect();
      const deltaTime = ((e.clientX - dragStartX) / rect.width) * totalDuration;

      if (dragging === 'clip') {
        updateClip(dragStartValues.clipId, {
          timelineStart: Math.max(0, dragStartValues.timelineStart + deltaTime),
        });
        return;
      }

      if (dragging === 'left') {
        let delta = deltaTime;
        if (dragStartValues.sourceStart + delta < 0) delta = -dragStartValues.sourceStart;
        if (dragStartValues.sourceDuration - delta < MIN_CLIP_DURATION) delta = dragStartValues.sourceDuration - MIN_CLIP_DURATION;
        if (dragStartValues.timelineStart + delta < 0) delta = -dragStartValues.timelineStart;
        updateClip(dragStartValues.clipId, {
          sourceStart: dragStartValues.sourceStart + delta,
          sourceDuration: dragStartValues.sourceDuration - delta,
          timelineStart: dragStartValues.timelineStart + delta,
        });
        return;
      }

      if (dragging === 'right') {
        let nextDuration = Math.max(MIN_CLIP_DURATION, dragStartValues.sourceDuration + deltaTime);
        if (dragStartValues.fileDuration > 0) {
          nextDuration = Math.min(nextDuration, dragStartValues.fileDuration - dragStartValues.sourceStart);
        }
        updateClip(dragStartValues.clipId, { sourceDuration: nextDuration });
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
      setDragStartValues(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartValues, dragStartX, seekToClientX, totalDuration, updateClip]);

  useEffect(() => {
    if (!scrollRef.current || zoom <= 1) return;
    const element = scrollRef.current;
    const playheadPx = (playheadPct / 100) * element.scrollWidth;
    const left = element.scrollLeft;
    const right = left + element.clientWidth;
    if (playheadPx < left + 60 || playheadPx > right - 60) {
      element.scrollLeft = playheadPx - element.clientWidth / 2;
    }
  }, [currentTime, playheadPct, zoom]);

  useEffect(() => {
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }
    };
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut]);

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeClipId) {
        e.preventDefault();
        deleteActiveClip();
      }
      if (e.key === 's' && activeClipId) {
        e.preventDefault();
        splitActiveClip();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeClipId, deleteActiveClip, splitActiveClip]);

  const markers = useMemo(() => {
    if (!totalDuration) return [];
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const interval = steps.find((step) => step >= (totalDuration / zoom) / 10) ?? 300;
    const values = [];
    for (let time = 0; time <= totalDuration + 0.001; time = Math.round((time + interval) * 10000) / 10000) {
      values.push(time);
      if (values.length > 500) break;
    }
    return values;
  }, [totalDuration, zoom]);

  if (!clips.length) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', height: 36 }}>
          <svg className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Timeline</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Upload a file to start editing</span>
          </div>
        </div>
      </div>
    );
  }

  const renderClip = (clip, laneKind) => {
    const isActive = clip.id === activeClipId;
    const file = files.find((item) => item.id === clip.fileId);
    const waveform = getWaveformBars(file, clip);
    const pctLeft = totalDuration > 0 ? (clip.timelineStart / totalDuration) * 100 : 0;
    const pctWidth = totalDuration > 0 ? (clip.sourceDuration / totalDuration) * 100 : 100;
    const isAudio = laneKind === 'audio';
    const accent = isAudio ? 'var(--color-orange)' : 'var(--color-accent)';

    return (
      <div
        key={clip.id}
        className="absolute"
        style={{
          top: isAudio ? 'calc(50% + 4px)' : '4px',
          height: 'calc(50% - 8px)',
          left: `${pctLeft}%`,
          width: `${Math.max(pctWidth, 0.3)}%`,
          borderRadius: 7,
          overflow: 'hidden',
          border: `2px solid ${isActive ? accent : 'rgba(120,115,110,0.2)'}`,
          background: isActive
            ? `linear-gradient(180deg, ${isAudio ? 'rgba(251,146,60,0.18)' : 'rgba(245,158,11,0.15)'} 0%, var(--color-bg-elevated) 100%)`
            : 'var(--color-bg-elevated)',
          boxShadow: isActive ? `0 0 0 1px ${accent}30` : 'none',
          cursor: 'pointer',
          zIndex: isActive ? 2 : 1,
          transition: 'border-color 0.12s, box-shadow 0.12s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          selectClip(clip.id);
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || e.target.dataset.clipbody) {
            onClipMouseDown(e, 'clip', clip);
          }
        }}
      >
        <div className="absolute inset-0 flex flex-col justify-between p-1.5 pointer-events-none" data-clipbody="1">
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isActive ? accent : 'var(--color-text-muted)',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            }}
          >
            {clip.name}
          </span>

          {waveform ? (
            <div className="flex items-end gap-[1px] overflow-hidden" style={{ height: isAudio ? '60%' : '45%' }}>
              {waveform.map((height, index) => (
                <div
                  key={index}
                  className="flex-1"
                  style={{
                    height: `${clamp(height, 4, 100)}%`,
                    minWidth: 0,
                    borderRadius: 1,
                    background: isActive ? 'var(--color-waveform-active)' : 'var(--color-waveform-inactive)',
                  }}
                />
              ))}
            </div>
          ) : (file?.hasAudio && file?.waveform?.length === 0) ? (
            <div className="flex items-end gap-[1px] overflow-hidden" style={{ height: isAudio ? '60%' : '45%' }}>
              {Array.from({ length: 40 }, (_, index) => (
                <div key={index} className="flex-1 shimmer" style={{ height: `${30 + Math.sin(index * 0.8) * 25}%`, minWidth: 0, borderRadius: 1 }} />
              ))}
            </div>
          ) : null}
        </div>

        {isActive && (
          <>
            <div
              style={{ position: 'absolute', left: 0, top: 0, width: 10, height: '100%', zIndex: 10, cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onClipMouseDown(e, 'left', clip);
              }}
            >
              <div style={{ width: 3, height: '50%', borderRadius: 3, background: accent, margin: 'auto', marginTop: '25%', boxShadow: `0 0 6px ${accent}80` }} />
            </div>
            <div
              style={{ position: 'absolute', right: 0, top: 0, width: 10, height: '100%', zIndex: 10, cursor: 'col-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onClipMouseDown(e, 'right', clip);
              }}
            >
              <div style={{ width: 3, height: '50%', borderRadius: 3, background: accent, margin: 'auto', marginTop: '25%', boxShadow: `0 0 6px ${accent}80` }} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col" style={{ userSelect: 'none' }}>
      <div className="flex items-center flex-shrink-0 px-2 gap-1.5" style={{ height: 36, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center gap-3 mr-2">
          {[
            { label: 'IN', value: fmt(trimStart), color: '#22c55e' },
            { label: 'OUT', value: fmt(trimEnd), color: 'var(--color-accent)' },
            { label: 'NOW', value: fmt(currentTime), color: 'var(--color-orange)' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-0.5">
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{item.label}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: item.color }}>{item.value}</span>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <ToolButton onClick={splitActiveClip} title="Split clip at playhead (S)" disabled={!activeClipId}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4" />
          </svg>
        </ToolButton>
        <ToolButton onClick={deleteActiveClip} title="Delete clip (Del)" disabled={!activeClipId} danger>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </ToolButton>

        <div style={{ width: 1, height: 16, background: 'var(--color-border)', flexShrink: 0, margin: '0 2px' }} />

        <ToolButton onClick={moveActiveClipLeft} title="Move clip left" disabled={!activeClipId || isFirst}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </ToolButton>
        <ToolButton onClick={moveActiveClipRight} title="Move clip right" disabled={!activeClipId || isLast}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </ToolButton>
        <ToolButton onClick={compactTimeline} title="Remove gaps (compact)">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </ToolButton>

        <div style={{ width: 1, height: 16, background: 'var(--color-border)', flexShrink: 0, margin: '0 2px' }} />

        <ToolButton onClick={zoomOut} title="Zoom out (Ctrl+scroll)">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </ToolButton>
        <button
          type="button"
          onClick={zoomReset}
          title="Reset zoom"
          style={{
            height: 26,
            padding: '0 7px',
            borderRadius: 6,
            fontSize: 10,
            fontFamily: 'monospace',
            minWidth: 36,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-tertiary)',
            color: zoom !== 1 ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {zoom === 1 ? '1x' : `${zoom.toFixed(1)}x`}
        </button>
        <ToolButton onClick={zoomIn} title="Zoom in (Ctrl+scroll)">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </ToolButton>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-shrink-0 flex flex-col" style={{ width: 44, borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)' }}>
          <div style={{ height: 24, borderBottom: '1px solid var(--color-border)' }} />
          <TrackBadge kind="video" label="V1" />
          <TrackBadge kind="audio" label="A1" />
        </div>

        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div style={{ width: `${zoom * 100}%`, minWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              className="flex-shrink-0 relative select-none"
              style={{ height: 24, background: 'var(--color-ruler-bg)', borderBottom: '1px solid var(--color-border)', cursor: 'ew-resize' }}
              onMouseDown={onRulerMouseDown}
            >
              {markers.map((time, index) => {
                const pct = totalDuration > 0 ? (time / totalDuration) * 100 : 0;
                const isMajor = index % 5 === 0 || markers.length <= 12;
                return (
                  <div key={index} className="absolute top-0 flex flex-col items-start" style={{ left: `${pct}%`, pointerEvents: 'none' }}>
                    <div style={{ width: 1, height: isMajor ? 10 : 5, marginTop: isMajor ? 0 : 5, background: isMajor ? 'var(--color-border-light)' : 'var(--color-border)' }} />
                    {isMajor && (
                      <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-muted)', marginLeft: 2, whiteSpace: 'nowrap', marginTop: 1 }}>
                        {fmt(time)}
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="absolute top-0 h-full pointer-events-none z-20" style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}>
                <div style={{ width: 1, height: '100%', background: 'var(--color-accent)', opacity: 0.8 }} />
              </div>

              <div
                className="absolute z-30"
                style={{ left: `${playheadPct}%`, top: 0, transform: 'translateX(-50%)', cursor: 'ew-resize', pointerEvents: 'all' }}
                onMouseDown={onPlayheadMouseDown}
              >
                <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid var(--color-accent)' }} />
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%) translateY(-100%)',
                    background: 'var(--color-accent)',
                    color: '#000',
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '3px 3px 0 0',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {fmt(currentTime)}
                </div>
              </div>
            </div>

            <div
              ref={trackRef}
              className="relative"
              style={{ flex: 1, minHeight: 168, background: 'var(--color-timeline-track)', cursor: 'default' }}
              onMouseDown={onTrackMouseDown}
              onMouseMove={(e) => {
                const track = trackRef.current;
                if (!track || !totalDuration) return;
                const rect = track.getBoundingClientRect();
                setHoverTime(clamp(((e.clientX - rect.left) / rect.width) * totalDuration, 0, totalDuration));
              }}
              onMouseLeave={() => setHoverTime(null)}
            >
              {markers.filter((_, index) => index % 5 === 0).map((time, index) => (
                <div key={index} className="absolute top-0 h-full pointer-events-none" style={{ left: `${(time / totalDuration) * 100}%`, width: 1, background: 'rgba(128,128,128,0.04)' }} />
              ))}

              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.05)' }} />
                <div style={{ flex: 1 }} />
              </div>

              {videoClips.map((clip) => renderClip(clip, 'video'))}
              {audioClips.map((clip) => renderClip(clip, 'audio'))}

              {hoverTime !== null && dragging !== 'playhead' && (
                <div className="absolute top-0 h-full pointer-events-none z-10" style={{ left: `${(hoverTime / totalDuration) * 100}%`, transform: 'translateX(-50%)' }}>
                  <div style={{ width: 1, height: '100%', background: 'rgba(255,255,255,0.15)' }} />
                  <div style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 9, fontFamily: 'monospace', whiteSpace: 'nowrap', padding: '1px 5px', borderRadius: 3 }}>
                    {fmt(hoverTime)}
                  </div>
                </div>
              )}

              <div className="absolute top-0 h-full z-20" style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)', cursor: 'ew-resize' }} onMouseDown={onPlayheadMouseDown}>
                <div style={{ width: 2, height: '100%', background: 'linear-gradient(to bottom, var(--color-accent), rgba(245,158,11,0.15))', boxShadow: '0 0 6px rgba(245,158,11,0.4)' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
