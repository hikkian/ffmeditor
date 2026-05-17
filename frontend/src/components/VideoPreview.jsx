import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store';
import { debugError, debugLog } from '../utils/debug';
import { formatTime } from '../utils/helpers';

export default function VideoPreview() {
  const videoUrl       = useStore((s) => s.videoUrl);
  const activeFile     = useStore((s) => s.activeFile);
  const clips          = useStore((s) => s.clips);
  const activeClipId   = useStore((s) => s.activeClipId);
  const trimStart      = useStore((s) => s.trimStart);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const setVideoDuration = useStore((s) => s.setVideoDuration);

  const videoRef    = useRef(null);
  const previewRef  = useRef(null);
  const playingClipRef = useRef(null);
  const gapClockRef    = useRef(null);

  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const [currentTime, setLocalCurrentTime] = useState(0);
  const [duration, setLocalDuration]       = useState(0);
  const [volume, setVolume]     = useState(1);
  const [isMuted, setIsMuted]   = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [decodeError, setDecodeError] = useState(false);

  const activeClip = clips.find((clip) => clip.id === activeClipId) || null;

  const mapVideoTimeToTimeline = useCallback((videoTime) => {
    const safeTime = Math.max(0, Number(videoTime) || 0);
    if (!activeClip) return safeTime;
    return Math.max(0, activeClip.timelineStart + (safeTime - activeClip.sourceStart));
  }, [activeClip]);

  const getClipStartVideoTime = useCallback(() => (
    activeClip ? activeClip.sourceStart : (trimStart || 0)
  ), [activeClip, trimStart]);

  const syncStoreTimeFromVideo = useCallback((videoTime) => {
    const timelineTime = mapVideoTimeToTimeline(videoTime);
    setCurrentTime(timelineTime);
  }, [mapVideoTimeToTimeline, setCurrentTime]);

  // Timeline-aware playback loop
  useEffect(() => {
    if (!isTimelinePlaying) return;

    let rafId = null;
    let endHandled = false;
    let frameCount = 0;

    const tick = () => {
      frameCount++;
      const vid = videoRef.current;
      if (!vid) { rafId = requestAnimationFrame(tick); return; }

      if (gapClockRef.current) {
        const { startWall, gapStart, nextClip } = gapClockRef.current;
        const cursor = gapStart + (Date.now() - startWall) / 1000;
        if (frameCount % 4 === 0) {
          setCurrentTime(cursor);
        }
        if (cursor >= nextClip.timelineStart) {
          gapClockRef.current = null;
          endHandled = false;
          playingClipRef.current = nextClip;
          try { vid.currentTime = nextClip.sourceStart; } catch {}
          vid.play().catch(() => {});
        }
        rafId = requestAnimationFrame(tick);
        return;
      }

      const clip = playingClipRef.current;
      if (!clip) { rafId = requestAnimationFrame(tick); return; }

      const timelineTime = clip.timelineStart + (vid.currentTime - clip.sourceStart);
      if (frameCount % 4 === 0) {
        const safeTimelineTime = Math.max(0, timelineTime);
        setCurrentTime(safeTimelineTime);
      }

      if (!endHandled && vid.currentTime >= clip.sourceStart + clip.sourceDuration - 0.06) {
        endHandled = true;
        const clips  = useStore.getState().clips;
        const endTL  = clip.timelineStart + clip.sourceDuration;
        const next   = clips
          .filter((c) => c.id !== clip.id && c.timelineStart >= endTL - 0.02)
          .sort((a, b) => a.timelineStart - b.timelineStart)[0] || null;

        if (!next) { vid.pause(); setIsTimelinePlaying(false); return; }

        const gap = next.timelineStart - endTL;
        if (gap < 0.05) {
          playingClipRef.current = next;
          endHandled = false;
        } else {
          vid.pause();
          gapClockRef.current = { startWall: Date.now(), gapStart: endTL, nextClip: next };
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [isTimelinePlaying, setCurrentTime]);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;

    if (isTimelinePlaying) {
      gapClockRef.current = null;
      setIsTimelinePlaying(false);
      vid.pause();
      syncStoreTimeFromVideo(vid.currentTime);
      return;
    }

    const state      = useStore.getState();
    const activeClip = state.clips.find((c) => c.id === state.activeClipId);
    if (activeClip) {
      playingClipRef.current = activeClip;
      const outside = vid.currentTime < activeClip.sourceStart
        || vid.currentTime >= activeClip.sourceStart + activeClip.sourceDuration;
      if (outside) { try { vid.currentTime = activeClip.sourceStart; } catch {} }
    } else {
      playingClipRef.current = null;
    }

    gapClockRef.current = null;
    setIsTimelinePlaying(true);
    vid.play().catch((err) => {
      debugError('VideoPreview.togglePlay', 'play failed', { message: err?.message });
      setIsTimelinePlaying(false);
    });
  }, [isTimelinePlaying, syncStoreTimeFromVideo, videoUrl]);

  const stopPlayback = useCallback(() => {
    gapClockRef.current  = null;
    playingClipRef.current = null;
    setIsTimelinePlaying(false);
    const vid = videoRef.current;
    if (!vid) return;
    vid.pause();
    const nextVideoTime = getClipStartVideoTime();
    try { vid.currentTime = nextVideoTime; } catch {}
    setLocalCurrentTime(nextVideoTime);
    syncStoreTimeFromVideo(nextVideoTime);
  }, [getClipStartVideoTime, syncStoreTimeFromVideo]);

  const resetPlaybackToStart = useCallback(() => {
    gapClockRef.current = null;
    playingClipRef.current = null;
    setIsTimelinePlaying(false);
    const vid = videoRef.current;
    if (!vid) return;
    const nextVideoTime = getClipStartVideoTime();
    try { vid.pause(); } catch {}
    try { vid.currentTime = nextVideoTime; } catch {}
    setLocalCurrentTime(nextVideoTime);
    syncStoreTimeFromVideo(nextVideoTime);
  }, [getClipStartVideoTime, syncStoreTimeFromVideo]);

  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextVideoTime = vid.currentTime;
    setLocalCurrentTime(nextVideoTime);
    if (!isTimelinePlaying) {
      syncStoreTimeFromVideo(nextVideoTime);
    }
  }, [isTimelinePlaying, syncStoreTimeFromVideo]);

  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    debugLog('VideoPreview', 'loadedmetadata', { duration: vid.duration });
    setLocalDuration(vid.duration || 0);
    setVideoDuration(vid.duration || 0);
    setIsMediaReady(false);
    setDecodeError(false);
    const nextVideoTime = getClipStartVideoTime();
    try { vid.currentTime = nextVideoTime; } catch {}
    setLocalCurrentTime(nextVideoTime);
    syncStoreTimeFromVideo(nextVideoTime);
  }, [getClipStartVideoTime, setVideoDuration, syncStoreTimeFromVideo]);

  const handleLoadedData  = useCallback(() => { setIsMediaReady(true); setDecodeError(false); }, []);
  const handleError       = useCallback(() => {
    const err = videoRef.current?.error;
    debugError('VideoPreview', 'media error', { code: err?.code });
    // Stop the RAF loop — otherwise it runs forever calling setCurrentTime
    gapClockRef.current    = null;
    playingClipRef.current = null;
    setIsTimelinePlaying(false);
    setIsMediaReady(false);
    setDecodeError(true);
    try { videoRef.current?.pause(); } catch {}
  }, []);

  const handleSeek = useCallback((e) => {
    const vid = videoRef.current;
    if (!vid) return;
    const time = parseFloat(e.target.value);
    try { vid.currentTime = time; } catch {}
    setLocalCurrentTime(time);
    syncStoreTimeFromVideo(time);
  }, [syncStoreTimeFromVideo]);

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
    vid.muted  = v === 0;
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

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.volume = volume;
    vid.muted  = isMuted || volume === 0;
  }, [volume, isMuted]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || isTimelinePlaying) return;
    const state = useStore.getState();
    const clip = state.clips.find((c) => c.id === activeClipId);
    if (!clip) return;
    const playhead = state.currentTime;
    const clipEnd = clip.timelineStart + clip.sourceDuration;
    const targetVideoTime = (playhead >= clip.timelineStart && playhead <= clipEnd)
      ? clip.sourceStart + (playhead - clip.timelineStart)
      : clip.sourceStart;
    try { vid.currentTime = targetVideoTime; } catch {}
    setLocalCurrentTime(targetVideoTime);
    // Do NOT write back to currentTime — preserve the user's seek position
  }, [activeClipId, isTimelinePlaying]);

  useEffect(() => () => {
    gapClockRef.current    = null;
    playingClipRef.current = null;
  }, []);

  const displayName = activeFile?.name || null;

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 rounded-full accent-gradient" />
          <h2 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Preview</h2>
          {displayName && (
            <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[200px]">{displayName}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!videoUrl}
            className="soft-button inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
            aria-label={isTimelinePlaying ? 'Pause' : 'Play'}
          >
            {isTimelinePlaying ? (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                <span className="text-[10px] font-semibold">Pause</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-[10px] font-semibold">Play</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={stopPlayback}
            disabled={!videoUrl}
            className="soft-button w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
            aria-label="Stop"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={previewRef} className="preview-stage flex-1 flex items-center justify-center relative overflow-hidden">
        {videoUrl ? (
          <div className="w-full h-full flex items-center justify-center relative">
            <video
              key={videoUrl}
              ref={videoRef}
              src={videoUrl}
              preload="auto"
              playsInline
              className={`w-full h-full object-contain${decodeError ? ' opacity-0 pointer-events-none absolute' : ''}`}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={handleLoadedData}
              onError={handleError}
              onEnded={resetPlaybackToStart}
              onClick={togglePlay}
            />

            {decodeError && (
              <div className="flex flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <svg className="w-7 h-7" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Preview unavailable</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    This codec isn't supported by the browser.<br />Export via FFmpeg still works normally.
                  </p>
                </div>
              </div>
            )}

            {/* Play overlay */}
            {!isTimelinePlaying && isMediaReady && (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center cursor-pointer bg-transparent"
                onClick={togglePlay}
                aria-label="Play"
              >
                <div
                  className="w-[4.5rem] h-[4.5rem] rounded-2xl flex items-center justify-center transition-all hover:scale-105"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #fb923c)',
                    boxShadow: '0 12px 28px rgba(245,158,11,0.35)',
                  }}
                >
                  <svg className="w-7 h-7 text-black ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </button>
            )}

            {/* Loading overlay */}
            {!isMediaReady && (
              <div className="preview-loading absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span className="text-xs text-[var(--color-text-secondary)]">Loading&hellip;</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-8">
            <div className="w-20 h-20 rounded-2xl bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] flex items-center justify-center mb-4">
              <svg className="w-9 h-9 text-[var(--color-text-muted)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-secondary)]">No file selected</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5 max-w-[220px] leading-relaxed opacity-75">
              Upload media from the library and select a clip to preview
            </p>
          </div>
        )}

        {/* ── Overlay controls ── */}
        {videoUrl && (
          <div className="preview-controls-overlay absolute inset-x-0 bottom-0 px-4 pt-12 pb-3">
            {/* Seek bar */}
            <div className="mb-2.5">
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

            <div className="flex items-center justify-between gap-3">
              {/* Left: play controls + time */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #fb923c)' }}
                  aria-label={isTimelinePlaying ? 'Pause' : 'Play'}
                >
                  {isTimelinePlaying ? (
                    <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  onClick={stopPlayback}
                  className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)]/70 hover:bg-[var(--color-bg-elevated)] flex items-center justify-center text-[var(--color-text-primary)] transition-colors"
                  aria-label="Stop"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>

                <span className="text-xs font-mono text-[var(--color-text-secondary)] select-none">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Right: volume + fullscreen */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
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
                  className="w-16 h-[3px] cursor-pointer"
                  aria-label="Volume"
                />

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors ml-1"
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
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
