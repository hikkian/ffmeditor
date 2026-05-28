import { useRef, useState, useCallback, useEffect } from 'react';
import MediaLibrary from './components/MediaLibrary';
import VideoPreview from './components/VideoPreview';
import Timeline from './components/Timeline';
import EditingControls from './components/EditingControls';
import MetricsPanel from './components/MetricsPanel';
import ErrorToast from './components/ErrorToast';
import LoginPage from './components/LoginPage';
import useStore from './store';
import { getStoredToken, setStoredToken, getMe } from './api';

const MIN_LEFT = 220; const MAX_LEFT = 420;
const MIN_RIGHT = 260; const MAX_RIGHT = 480;
const MIN_TIMELINE = 140; const MAX_TIMELINE = 360;

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';
  return (
    <button
      onClick={onToggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
      style={{
        background: 'var(--color-bg-tertiary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)';
        e.currentTarget.style.color = 'var(--color-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }}
    >
      {isDark ? (
        /* Sun icon */
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        /* Moon icon */
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
      <span className="text-[10px] font-medium">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function ResizeHandle({ direction, onMouseDown }) {
  const isHoriz = direction === 'col';
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center"
      style={{
        width: isHoriz ? 5 : '100%',
        height: isHoriz ? '100%' : 5,
        cursor: isHoriz ? 'col-resize' : 'row-resize',
        zIndex: 10,
        position: 'relative',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: isHoriz ? (hovered ? 2 : 1) : '100%',
        height: isHoriz ? '100%' : (hovered ? 2 : 1),
        background: hovered ? 'var(--color-accent)' : 'var(--color-border)',
        boxShadow: hovered ? '0 0 6px rgba(245,158,11,0.4)' : 'none',
        transition: 'all 0.15s',
      }} />
    </div>
  );
}

export default function App() {
  const isExporting  = useStore((s) => s.isExporting);
  const downloadReady = useStore((s) => s.downloadReady);

  const [theme, setTheme] = useState(() => localStorage.getItem('ffm-theme') || 'dark');
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check stored token on mount; if valid, skip login
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setAuthReady(true); return; }
    getMe()
      .then(() => { setIsAuthenticated(true); setAuthReady(true); })
      .catch(() => { setStoredToken(null); setAuthReady(true); });
  }, []);

  const handleLogin = useCallback((token) => {
    setStoredToken(token);
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    setStoredToken(null);
    setIsAuthenticated(false);
  }, []);
  const [leftWidth, setLeftWidth]   = useState(280);
  const [rightWidth, setRightWidth] = useState(320);
  const [timelineH, setTimelineH]   = useState(210);
  const [showMetrics, setShowMetrics] = useState(false);
  const draggingRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ffm-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => t === 'dark' ? 'light' : 'dark'), []);

  const startDrag = useCallback((e, type) => {
    e.preventDefault();
    draggingRef.current = { type, startX: e.clientX, startY: e.clientY, leftWidth, rightWidth, timelineH };
    const onMove = (ev) => {
      const d = draggingRef.current;
      if (!d) return;
      if (d.type === 'left')
        setLeftWidth(Math.max(MIN_LEFT, Math.min(MAX_LEFT, d.leftWidth + ev.clientX - d.startX)));
      else if (d.type === 'right')
        setRightWidth(Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, d.rightWidth - (ev.clientX - d.startX))));
      else if (d.type === 'timeline')
        setTimelineH(Math.max(MIN_TIMELINE, Math.min(MAX_TIMELINE, d.timelineH - (ev.clientY - d.startY))));
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [leftWidth, rightWidth, timelineH]);

  const badge = downloadReady
    ? { dot: 'var(--color-success)', text: 'Ready', bg: 'var(--color-success-muted)', border: 'rgba(34,197,94,0.2)', color: 'var(--color-success)' }
    : isExporting
    ? { dot: 'var(--color-accent)', text: 'Exporting', bg: 'var(--color-accent-muted)', border: 'var(--color-accent-border)', color: 'var(--color-accent)' }
    : { dot: 'var(--color-text-muted)', text: 'Editing', bg: 'var(--color-bg-tertiary)', border: 'var(--color-border)', color: 'var(--color-text-secondary)' };

  if (!authReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <svg className="w-6 h-6 animate-spin" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div data-theme={theme}>
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--color-bg-primary)' }}>

      {/* ── Header ── */}
      <header className="flex items-center justify-between flex-shrink-0 px-4"
        style={{ height: 44, background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)', boxShadow: '0 2px 10px rgba(245,158,11,0.3)' }}
          >
            <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>FFM</span>
            <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--color-accent)' }}>Editor</span>
          </div>
          <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Video Editor</span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMetrics((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: showMetrics ? 'rgba(245,158,11,0.10)' : 'var(--color-bg-tertiary)',
              border: `1px solid ${showMetrics ? 'rgba(245,158,11,0.18)' : 'var(--color-border)'}`,
              color: showMetrics ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-[10px] font-medium">Metrics</span>
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button
            onClick={handleLogout}
            title="Sign out"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
            style={{
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            <span className="text-[10px] font-medium">Logout</span>
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
            style={{ background: badge.bg, border: `1px solid ${badge.border}` }}
          >
            <div className="w-1.5 h-1.5 rounded-full"
              style={{ background: badge.dot, animation: isExporting ? 'recording-pulse 1s ease-in-out infinite' : undefined }}
            />
            <span className="text-[10px] font-medium" style={{ color: badge.color }}>{badge.text}</span>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex flex-1 min-h-0">
        <aside className="flex-shrink-0" style={{ width: leftWidth, background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)' }}>
          <MediaLibrary />
        </aside>

        <ResizeHandle direction="col" onMouseDown={(e) => startDrag(e, 'left')} />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0" style={{ background: 'var(--color-surface)' }}>
            <VideoPreview />
          </div>

          <ResizeHandle direction="row" onMouseDown={(e) => startDrag(e, 'timeline')} />

          <div className="flex-shrink-0" style={{ height: timelineH, background: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border)' }}>
            <Timeline />
          </div>
        </div>

        <ResizeHandle direction="col" onMouseDown={(e) => startDrag(e, 'right')} />

        <aside
          className="flex-shrink-0 flex flex-col min-h-0 overflow-hidden"
          style={{ width: rightWidth, background: 'var(--color-bg-secondary)', borderLeft: '1px solid var(--color-border)' }}
        >
          {showMetrics ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <MetricsPanel onClose={() => setShowMetrics(false)} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              <EditingControls />
            </div>
          )}
        </aside>
      </div>

      <ErrorToast />

    </div>
  );
}
