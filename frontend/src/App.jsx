import { useEffect, useRef, useState } from 'react';

import MediaLibrary from './components/MediaLibrary';
import VideoPreview from './components/VideoPreview';
import Timeline from './components/Timeline';
import EditingControls from './components/EditingControls';
import MetricsPanel from './components/MetricsPanel';
import ErrorToast from './components/ErrorToast';

import { clamp } from './utils/helpers';

function getSavedNumber(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    // Ignore storage access errors in restricted environments.
    return fallback;
  }
}

function saveNumber(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage write errors in restricted environments.
  }
}

function getSavedTheme() {
  try {
    return window.localStorage.getItem('ffm_theme') || 'dark';
  } catch {
    // Ignore storage access errors in restricted environments.
    return 'dark';
  }
}

export default function App() {
  const containerRef = useRef(null);

  const [theme, setTheme] = useState(getSavedTheme);
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 768px)').matches
      : false
  ));

  const [leftWidth, setLeftWidth] = useState(() => getSavedNumber('ffm_left_width', 256));
  const [rightWidth, setRightWidth] = useState(() => getSavedNumber('ffm_right_width', 288));
  const [timelineHeight, setTimelineHeight] = useState(() => getSavedNumber('ffm_timeline_height', 140));

  const [resizeMode, setResizeMode] = useState(null);
  const [showMetrics, setShowMetrics] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('ffm_theme', theme);
    } catch {
      // Ignore storage write errors in restricted environments.
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => { saveNumber('ffm_left_width', leftWidth); }, [leftWidth]);
  useEffect(() => { saveNumber('ffm_right_width', rightWidth); }, [rightWidth]);
  useEffect(() => { saveNumber('ffm_timeline_height', timelineHeight); }, [timelineHeight]);

  useEffect(() => {
    if (!resizeMode) return;

    const onMouseMove = (e) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (resizeMode === 'left') setLeftWidth(clamp(e.clientX - rect.left, 200, 460));
      if (resizeMode === 'right') setRightWidth(clamp(rect.right - e.clientX, 240, 560));
      if (resizeMode === 'timeline') setTimelineHeight(clamp(rect.bottom - e.clientY, 100, 360));
    };

    const onMouseUp = () => {
      setResizeMode(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = resizeMode === 'timeline' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizeMode]);

  const startResize = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeMode(mode);
  };

  const resetLayout = () => {
    setLeftWidth(256);
    setRightWidth(288);
    setTimelineHeight(140);
  };

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div className="min-h-dvh w-full flex flex-col bg-[var(--color-bg-primary)] overflow-y-auto md:h-dvh md:overflow-hidden">
      <header className="flex items-center justify-between px-4 md:px-5 h-11 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[var(--color-accent)] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold tracking-tight whitespace-nowrap text-[var(--color-text-primary)]">
              FFM Editor
            </h1>
          </div>

          <div className="w-px h-4 bg-[var(--color-border)] hidden sm:block" />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider hidden sm:block">
            Video Editor
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetLayout}
            className="hidden md:block px-2 py-1 rounded text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            Reset layout
          </button>

          {/* Metrics toggle */}
          <button
            type="button"
            onClick={() => setShowMetrics((v) => !v)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              showMetrics
                ? 'bg-[var(--color-purple-muted)] text-[var(--color-purple)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
            }`}
            title="Performance Metrics"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="hidden sm:inline">Metrics</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.707.707M6.343 17.657l-.707.707m12.728 0-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>

          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--color-success-muted)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
            <span className="text-[10px] text-[var(--color-success)] font-medium">Ready</span>
          </div>
        </div>
      </header>

      <div ref={containerRef} className="flex flex-1 min-h-0 flex-col md:flex-row">
        <aside
          className="w-full md:flex-shrink-0 bg-[var(--color-bg-secondary)] border-b md:border-b-0 md:border-r border-[var(--color-border)] overflow-hidden"
          style={{ width: isDesktop ? `${leftWidth}px` : '100%' }}
        >
          <MediaLibrary />
        </aside>

        <div
          className="hidden md:block w-1 flex-shrink-0 cursor-col-resize hover:bg-[var(--color-accent)]/40 transition-colors"
          onMouseDown={startResize('left')}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 min-h-[280px] bg-[var(--color-surface)]">
            <VideoPreview />
          </div>

          <div
            className="hidden md:block h-1 flex-shrink-0 cursor-row-resize hover:bg-[var(--color-accent)]/40 transition-colors"
            onMouseDown={startResize('timeline')}
          />

          <div
            className="h-44 md:flex-shrink-0 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)] overflow-hidden"
            style={{ height: isDesktop ? `${timelineHeight}px` : undefined }}
          >
            <Timeline />
          </div>
        </div>

        <div
          className="hidden md:block w-1 flex-shrink-0 cursor-col-resize hover:bg-[var(--color-accent)]/40 transition-colors"
          onMouseDown={startResize('right')}
        />

        <aside
          className="w-full md:flex-shrink-0 bg-[var(--color-bg-secondary)] border-t md:border-t-0 md:border-l border-[var(--color-border)] overflow-hidden"
          style={{ width: isDesktop ? `${rightWidth}px` : '100%' }}
        >
          {showMetrics ? (
            <MetricsPanel onClose={() => setShowMetrics(false)} />
          ) : (
            <EditingControls />
          )}
        </aside>
      </div>

      <ErrorToast />
    </div>
  );
}
