import MediaLibrary from './components/MediaLibrary';
import VideoPreview from './components/VideoPreview';
import Timeline from './components/Timeline';
import EditingControls from './components/EditingControls';
import ErrorToast from './components/ErrorToast';

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--color-bg-primary)] overflow-hidden">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-5 h-12 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-purple)] flex items-center justify-center shadow-lg shadow-[var(--color-accent)]/20">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h1 className="text-sm font-bold tracking-tight">
              <span className="text-[var(--color-text-primary)]">FFM</span>
              <span className="text-[var(--color-accent)]"> Editor</span>
            </h1>
          </div>
          {/* Separator */}
          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
          <span className="text-[10px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">Video Editor</span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-success-muted)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
            <span className="text-[10px] text-[var(--color-success)] font-medium">Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel - Media Library */}
        <aside className="w-64 flex-shrink-0 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]">
          <MediaLibrary />
        </aside>

        {/* Center Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video Preview */}
          <div className="flex-1 min-h-0 bg-[var(--color-surface)]">
            <VideoPreview />
          </div>

          {/* Timeline */}
          <div className="h-[140px] flex-shrink-0 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]">
            <Timeline />
          </div>
        </div>

        {/* Right Panel - Editing Controls */}
        <aside className="w-72 flex-shrink-0 bg-[var(--color-bg-secondary)] border-l border-[var(--color-border)]">
          <EditingControls />
        </aside>
      </div>

      {/* Error Toast */}
      <ErrorToast />
    </div>
  );
}
