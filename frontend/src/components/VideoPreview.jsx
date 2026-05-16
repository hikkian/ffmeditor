import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store';
import { debugLog, debugError } from '../utils/debug';
import { formatTime } from '../utils/helpers';

export default function VideoPreview() {
  const videoUrl = useStore((s) => s.videoUrl);
  const activeFile = useStore((s) => s.activeFile);
  const trimStart = useStore((s) => s.trimStart);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setVideoDuration = useStore((s) => s.setVideoDuration);

  const videoRef = useRef(null);
  const previewRef = useRef(null);
  // Which clip is currently driving playback (set when user presses play)
  const playingClipRef = useRef(null);
  // Non-null while the playhead is sitting in a gap between clips
  // { startWall: number, gapStart: number, nextClip: object }
  const gapClockRef = useRef(null);

  // isTimelinePlaying stays true through gaps (video can be paused mid-gap)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const [currentTime, setLocalCurrentTime] = useState(0);
  const [duration, setLocalDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);


  // ─── Timeline playback engine ──────────────────────────────────────────────
  // Runs as a RAF loop whenever isTimelinePlaying is true.
  // Handles two modes:
  //   gap mode  – video is paused, wall-clock advances the timeline cursor
  //   clip mode – video is playing, we watch for the end of the clip range
  useEffect(() => {
    if (!isTimelinePlaying) return;

    let rafId = null;
    let endHandled = false;
    // Only push currentTime to the store every 4th frame (~15 fps).
    // End-of-clip detection still runs every frame for accuracy.
    let frameCount = 0;

    const tick = () => {
      frameCount++;
      const vid = videoRef.current;
      if (!vid) { rafId = requestAnimationFrame(tick); return; }

      // ── Gap mode ──────────────────────────────────────────────────────────
      if (gapClockRef.current) {
        const { startWall, gapStart, nextClip } = gapClockRef.current;
        const elapsed = (Date.now() - startWall) / 1000;
        const cursor = gapStart + elapsed;
        if (frameCount % 4 === 0) setCurrentTime(cursor);

        if (cursor >= nextClip.timelineStart) {
          gapClockRef.current = null;
          endHandled = false;
          playingClipRef.current = nextClip;
          try { vid.currentTime = nextClip.sourceStart; } catch { /* ignore */ }
          vid.play().catch(() => {});
        }

        rafId = requestAnimationFrame(tick);
        return;
      }

      // ── Clip mode ─────────────────────────────────────────────────────────
      const clip = playingClipRef.current;
      if (!clip) { rafId = requestAnimationFrame(tick); return; }

      // Push timeline cursor to store so the Timeline playhead moves
      const timelineTime = clip.timelineStart + (vid.currentTime - clip.sourceStart);
      if (frameCount % 4 === 0) setCurrentTime(Math.max(0, timelineTime));

      // Detect end of this clip's source window
      if (!endHandled && vid.currentTime >= clip.sourceStart + clip.sourceDuration - 0.06) {
        endHandled = true;

        const clips = useStore.getState().clips;
        const endTL = clip.timelineStart + clip.sourceDuration;

        const next = clips
          .filter((c) => c.id !== clip.id && c.timelineStart >= endTL - 0.02)
          .sort((a, b) => a.timelineStart - b.timelineStart)[0] || null;

        if (!next) {
          vid.pause();
          setIsTimelinePlaying(false);
          return; // stop RAF
        }

        const gap = next.timelineStart - endTL;

        if (gap < 0.05) {
          // Clips are back-to-back — just hand off the ref
          playingClipRef.current = next;
          endHandled = false;
        } else {
          // Real gap — pause video, start wall-clock gap timer
          vid.pause();
          gapClockRef.current = { startWall: Date.now(), gapStart: endTL, nextClip: next };
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [isTimelinePlaying, setCurrentTime]);

  // ─── Playback controls ────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;

    if (isTimelinePlaying) {
      gapClockRef.current = null;
      setIsTimelinePlaying(false);
      vid.pause();
      return;
    }

    const state = useStore.getState();
    const activeClip = state.clips.find((c) => c.id === state.activeClipId);
    if (activeClip) {
      playingClipRef.current = activeClip;
      const outside = vid.currentTime < activeClip.sourceStart
        || vid.currentTime >= activeClip.sourceStart + activeClip.sourceDuration;
      if (outside) {
        try { vid.currentTime = activeClip.sourceStart; } catch { /* ignore */ }
      }
    } else {
      playingClipRef.current = null;
    }

    gapClockRef.current = null;
    setIsTimelinePlaying(true);
    vid.play().catch((err) => {
      debugError('VideoPreview.togglePlay', 'play failed', { message: err?.message || String(err) });
      setIsTimelinePlaying(false);
    });
  }, [isTimelinePlaying, videoUrl]);

  const stopPlayback = useCallback(() => {
    gapClockRef.current = null;
    playingClipRef.current = null;
    setIsTimelinePlaying(false);
    const vid = videoRef.current;
    if (!vid) return;
    vid.pause();
    try { vid.currentTime = trimStart || 0; } catch { /* ignore */ }
    setLocalCurrentTime(trimStart || 0);
    setCurrentTime(trimStart || 0);
  }, [trimStart, setCurrentTime]);

  // ─── Video event handlers ─────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    // Only update the local progress-bar position here.
    // The store's currentTime is driven by the RAF loop.
    setLocalCurrentTime(vid.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    debugLog('VideoPreview', 'loadedmetadata', { duration: vid.duration });
    setLocalDuration(vid.duration || 0);
    setVideoDuration(vid.duration || 0);
    setIsMediaReady(false);
    try { vid.currentTime = trimStart || 0; } catch { /* ignore */ }
    setLocalCurrentTime(trimStart || 0);
  }, [setVideoDuration, trimStart]);

  const handleLoadedData = useCallback(() => { setIsMediaReady(true); }, []);

  const handleError = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const err = vid.error;
    debugError('VideoPreview', 'media error', { code: err?.code });
    useStore.getState().setError(`Preview decode failed${err?.code ? ` (code ${err.code})` : ''}`);
  }, []);

  const handleSeek = useCallback((e) => {
    const vid = videoRef.current;
    if (!vid) return;
    const time = parseFloat(e.target.value);
    try { vid.currentTime = time; } catch { /* ignore */ }
    setLocalCurrentTime(time);
    setCurrentTime(time);
  }, [setCurrentTime]);

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
    vid.muted = v === 0;
    setVolume(v);
    setIsMuted(v === 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!previewRef.current) return;
    if (!document.fullscreenElement) {
      previewRef.current.requestFullscreen().catch((err) => {
        useStore.getState().setError(`Fullscreen unavailable: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // ─── Side effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.volume = volume;
    vid.muted = isMuted || volume === 0;
  }, [volume, isMuted]);

  useEffect(() => () => {
    gapClockRef.current = null;
    playingClipRef.current = null;
  }, []);

  const displayName = activeFile?.name || null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-purple)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
          </svg>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Preview</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
            aria-label={isTimelinePlaying ? 'Pause preview' : 'Play preview'}
            title={isTimelinePlaying ? 'Pause' : 'Play'}
            disabled={!videoUrl}
          >
            {isTimelinePlaying ? (
              <>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                <span className="text-[10px] font-medium">Pause</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-[10px] font-medium">Play</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={stopPlayback}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
            aria-label="Stop preview"
            title="Stop"
            disabled={!videoUrl}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
            <span className="text-[10px] font-medium">Stop</span>
          </button>

          {displayName && (
            <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[160px]">
              {displayName}
            </span>
          )}
        </div>
      </div>

      <div ref={previewRef} className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
        {videoUrl ? (
          <div className="w-full h-full flex items-center justify-center relative">
            <video
              key={videoUrl}
              ref={videoRef}
              src={videoUrl}
              preload="auto"
              playsInline
              className="w-full h-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={handleLoadedData}
              onError={handleError}
              onEnded={() => {
                setIsTimelinePlaying(false);
                gapClockRef.current = null;
                playingClipRef.current = null;
              }}
              onClick={togglePlay}
            />

            {!isTimelinePlaying && isMediaReady && (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center cursor-pointer bg-transparent"
                onClick={togglePlay}
                aria-label="Play preview"
              >
                <div className="w-16 h-16 rounded-full bg-[var(--color-accent)]/80 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-[var(--color-accent)]/20 hover:bg-[var(--color-accent)] transition-colors">
                  <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </button>
            )}

            {!isMediaReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                <span className="text-xs text-white/70 font-medium">Loading preview…</span>
              </div>
            )}
          </div>
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

        {videoUrl && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-14 pb-4">
            <div className="mb-2">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="w-8 h-8 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] flex items-center justify-center transition-colors"
                  onClick={togglePlay}
                  aria-label={isTimelinePlaying ? 'Pause preview' : 'Play preview'}
                >
                  {isTimelinePlaying ? (
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  onClick={stopPlayback}
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white"
                  aria-label="Stop preview"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>

                <span className="text-xs font-mono text-white/70">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-white/70 hover:text-white transition-colors"
                >
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
                  className="w-16 h-[3px] cursor-pointer accent-white"
                  aria-label="Volume"
                />
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="text-white/70 hover:text-white transition-colors ml-1"
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
