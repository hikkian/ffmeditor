import { useRef, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import useStore from '../store';

export default function VideoPreview() {
  const videoUrl = useStore((s) => s.videoUrl);
  const activeFile = useStore((s) => s.activeFile);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setVideoDuration = useStore((s) => s.setVideoDuration);
  const trimStart = useStore((s) => s.trimStart);
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setLocalCurrentTime] = useState(0);
  const [duration, setLocalDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play();
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    setLocalCurrentTime(vid.currentTime);
    setCurrentTime(vid.currentTime);
  }, [setCurrentTime]);

  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    setLocalDuration(vid.duration);
    setVideoDuration(vid.duration);
  }, [setVideoDuration]);

  const handleSeek = useCallback((e) => {
    const vid = videoRef.current;
    if (!vid) return;
    const time = parseFloat(e.target.value);
    vid.currentTime = time;
    setLocalCurrentTime(time);
  }, []);

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = !vid.muted;
    setIsMuted(vid.muted);
  }, []);

  const handleVolumeChange = useCallback((e) => {
    const vid = videoRef.current;
    if (!vid) return;
    const v = parseFloat(e.target.value);
    vid.volume = v;
    setVolume(v);
    if (v === 0) setIsMuted(true);
    else setIsMuted(false);
  }, []);

  // Seek to trimStart when it changes
  useEffect(() => {
    const vid = videoRef.current;
    if (vid && trimStart >= 0) {
      vid.currentTime = trimStart;
    }
  }, [trimStart]);

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-purple)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
          </svg>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Preview</h2>
        </div>
        {activeFile && (
          <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[160px]">{activeFile.name}</span>
        )}
      </div>

      {/* Video Area */}
      <div className="flex-1 flex items-center justify-center bg-black/40 relative overflow-hidden">
        {videoUrl ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full h-full flex items-center justify-center"
          >
            <video
              id="video-preview-player"
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onClick={togglePlay}
            />
            {/* Play overlay */}
            {!isPlaying && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute inset-0 flex items-center justify-center cursor-pointer"
                onClick={togglePlay}
              >
                <div className="w-16 h-16 rounded-full bg-[var(--color-accent)]/80 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-[var(--color-accent)]/20 hover:bg-[var(--color-accent)] transition-colors">
                  <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </motion.button>
            )}
          </motion.div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-8">
            <div className="w-20 h-20 rounded-2xl bg-[var(--color-bg-tertiary)] flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
              </svg>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] font-medium">Select a file to preview</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">Upload and select media from the library</p>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      {videoUrl && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          {/* Seek bar */}
          <div className="mb-2">
            <input
              id="video-seek-bar"
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1"
            />
          </div>
          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                id="play-pause-btn"
                className="w-8 h-8 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] flex items-center justify-center transition-colors"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              {/* Time */}
              <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            {/* Volume */}
            <div className="flex items-center gap-2">
              <button onClick={toggleMute} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                {isMuted || volume === 0 ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
