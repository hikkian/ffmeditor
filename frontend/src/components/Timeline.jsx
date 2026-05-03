import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import useStore from '../store';

export default function Timeline() {
  const videoDuration = useStore((s) => s.videoDuration);
  const trimStart = useStore((s) => s.trimStart);
  const trimDuration = useStore((s) => s.trimDuration);
  const setTrimStart = useStore((s) => s.setTrimStart);
  const setTrimDuration = useStore((s) => s.setTrimDuration);
  const currentTime = useStore((s) => s.currentTime);
  const activeFile = useStore((s) => s.activeFile);

  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'left' | 'right' | 'clip' | null
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartValues, setDragStartValues] = useState({ start: 0, duration: 0 });

  const trimEnd = trimStart + trimDuration;

  const pctStart = videoDuration > 0 ? (trimStart / videoDuration) * 100 : 0;
  const pctWidth = videoDuration > 0 ? (trimDuration / videoDuration) * 100 : 100;
  const playheadPct = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00.0';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Time markers
  const markers = useMemo(() => {
    if (!videoDuration) return [];
    const count = Math.min(Math.floor(videoDuration / 5) + 1, 20);
    const step = videoDuration / count;
    const arr = [];
    for (let i = 0; i <= count; i++) {
      arr.push(i * step);
    }
    return arr;
  }, [videoDuration]);

  const getTimeFromX = useCallback(
    (clientX) => {
      const track = trackRef.current;
      if (!track || !videoDuration) return 0;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * videoDuration;
    },
    [videoDuration]
  );

  const handleMouseDown = useCallback(
    (e, type) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(type);
      setDragStartX(e.clientX);
      setDragStartValues({ start: trimStart, duration: trimDuration });
    },
    [trimStart, trimDuration]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const track = trackRef.current;
      if (!track || !videoDuration) return;

      const rect = track.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX;
      const deltaPct = deltaX / rect.width;
      const deltaTime = deltaPct * videoDuration;

      if (dragging === 'left') {
        let newStart = Math.max(0, dragStartValues.start + deltaTime);
        let newDur = dragStartValues.duration - (newStart - dragStartValues.start);
        if (newDur < 0.5) {
          newDur = 0.5;
          newStart = dragStartValues.start + dragStartValues.duration - 0.5;
        }
        setTrimStart(Math.max(0, newStart));
        setTrimDuration(newDur);
      } else if (dragging === 'right') {
        let newDur = Math.max(0.5, dragStartValues.duration + deltaTime);
        if (dragStartValues.start + newDur > videoDuration) {
          newDur = videoDuration - dragStartValues.start;
        }
        setTrimDuration(newDur);
      } else if (dragging === 'clip') {
        let newStart = dragStartValues.start + deltaTime;
        newStart = Math.max(0, Math.min(newStart, videoDuration - dragStartValues.duration));
        setTrimStart(newStart);
      }
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartX, dragStartValues, videoDuration, setTrimStart, setTrimDuration]);

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
          </svg>
          <span className="text-xs">Upload a file to use the timeline</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">Timeline</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">IN</span>
            <span className="text-[11px] font-mono text-[var(--color-success)]">{formatTime(trimStart)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">OUT</span>
            <span className="text-[11px] font-mono text-[var(--color-error)]">{formatTime(trimEnd)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-text-muted)]">DUR</span>
            <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{formatTime(trimDuration)}</span>
          </div>
        </div>
      </div>

      {/* Time Ruler */}
      <div className="px-4 pt-2">
        <div className="relative h-5 border-b border-[var(--color-border)]">
          {markers.map((time, i) => {
            const pct = (time / videoDuration) * 100;
            return (
              <div key={i} className="absolute top-0 flex flex-col items-center" style={{ left: `${pct}%` }}>
                <div className="w-px h-2 bg-[var(--color-border-light)]" />
                <span className="text-[9px] text-[var(--color-text-muted)] font-mono mt-0.5">{formatTime(time)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Track Area */}
      <div className="flex-1 px-4 py-3">
        <div
          ref={trackRef}
          className="relative h-14 bg-[var(--color-timeline-track)] rounded-lg overflow-hidden border border-[var(--color-border)]"
        >
          {/* Background waveform placeholder */}
          <div className="absolute inset-0 flex items-center justify-center gap-[2px] px-2 opacity-20">
            {Array.from({ length: 80 }).map((_, i) => (
              <div
                key={i}
                className="w-[2px] bg-[var(--color-text-muted)] rounded-full"
                style={{ height: `${15 + Math.random() * 70}%` }}
              />
            ))}
          </div>

          {/* Clip Region */}
          <motion.div
            className="absolute top-0 h-full cursor-grab active:cursor-grabbing"
            style={{
              left: `${pctStart}%`,
              width: `${pctWidth}%`,
            }}
            onMouseDown={(e) => handleMouseDown(e, 'clip')}
          >
            {/* Clip fill */}
            <div className="absolute inset-0 bg-[var(--color-accent)]/20 border-y-2 border-[var(--color-accent)]" />

            {/* Left handle */}
            <div
              className="absolute left-0 top-0 w-3 h-full cursor-col-resize z-10 flex items-center justify-center group"
              onMouseDown={(e) => handleMouseDown(e, 'left')}
            >
              <div className="w-1 h-8 bg-[var(--color-accent)] rounded-full group-hover:bg-[var(--color-accent-hover)] group-hover:w-1.5 transition-all" />
            </div>

            {/* Right handle */}
            <div
              className="absolute right-0 top-0 w-3 h-full cursor-col-resize z-10 flex items-center justify-center group"
              onMouseDown={(e) => handleMouseDown(e, 'right')}
            >
              <div className="w-1 h-8 bg-[var(--color-accent)] rounded-full group-hover:bg-[var(--color-accent-hover)] group-hover:w-1.5 transition-all" />
            </div>

            {/* Clip label */}
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] font-medium text-[var(--color-accent)] opacity-80 truncate">
                {activeFile?.name}
              </span>
            </div>
          </motion.div>

          {/* Playhead */}
          <div
            className="absolute top-0 w-0.5 h-full bg-white z-20 pointer-events-none"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
