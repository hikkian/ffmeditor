import { useEffect, useState } from 'react';
import { getMetricsSystem } from '../api';
import useStore from '../store';

const FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'mp3', 'aac', 'wav', 'flac', 'ogg', 'avi', 'm4a'];
const VIDEO_CODECS = ['copy', 'libx264', 'libx265', 'libvpx-vp9'];
const AUDIO_CODECS = ['copy', 'aac', 'libmp3lame', 'libopus', 'flac'];
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

function SelectField({ id, label, value, onChange, options }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function NumberField({ id, label, value, onChange, placeholder, min, max, step }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <input
        id={id} type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={placeholder} min={min} max={max} step={step}
        className="input-field"
      />
    </div>
  );
}

function TextField({ id, label, value, onChange, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-field" />
    </div>
  );
}

function ToggleField({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between cursor-pointer group py-0.5">
      <span className="text-xs transition-colors" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <div className="relative">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
        <div
          className="w-9 h-5 rounded-full transition-all"
          style={{
            background: checked ? 'linear-gradient(135deg, #f59e0b, #fb923c)' : 'var(--color-bg-tertiary)',
            border: checked ? 'none' : '1px solid var(--color-border)',
            boxShadow: checked ? '0 0 8px rgba(245,158,11,0.3)' : 'none',
          }}
        >
          <div
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: checked ? 'translateX(1.1rem)' : 'translateX(0.125rem)' }}
          />
        </div>
      </div>
    </label>
  );
}

function SliderField({ label, min, max, step, value, onChange, format }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
        <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function Section({ title, accent, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-2 group"
      >
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
        <div className="w-4 h-4 flex-shrink-0" style={{ color: accent }}>{icon}</div>
        <span className="text-[11px] font-semibold uppercase tracking-wider flex-1 text-left" style={{ color: 'var(--color-text-secondary)' }}>{title}</span>
        <svg
          className="w-3 h-3 transition-transform"
          style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="space-y-3 pb-1">{children}</div>}
    </div>
  );
}

const Divider = () => <div className="h-px" style={{ background: 'var(--color-border)' }} />;

function InfoPill({ label, value, tone = 'default' }) {
  const tones = {
    default: { bg: 'var(--color-bg-tertiary)', border: 'var(--color-border)', color: 'var(--color-text-secondary)' },
    accent: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.18)', color: '#f59e0b' },
    success: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.18)', color: '#22c55e' },
  };
  const t = tones[tone] || tones.default;
  return (
    <div className="px-2.5 py-1.5 rounded-lg border" style={{ background: t.bg, borderColor: t.border }}>
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      <div className="text-[11px] font-mono font-semibold" style={{ color: t.color }}>{value}</div>
    </div>
  );
}

export default function EditingControls() {
  const trimStart      = useStore((s) => s.trimStart);
  const trimDuration   = useStore((s) => s.trimDuration);
  const videoDuration  = useStore((s) => s.videoDuration);
  const resizeWidth    = useStore((s) => s.resizeWidth);
  const resizeHeight   = useStore((s) => s.resizeHeight);
  const keepAspect     = useStore((s) => s.keepAspect);
  const outputFormat   = useStore((s) => s.outputFormat);
  const videoCodec     = useStore((s) => s.videoCodec);
  const audioCodec     = useStore((s) => s.audioCodec);
  const removeAudio    = useStore((s) => s.removeAudio);
  const preset         = useStore((s) => s.preset);
  const crf            = useStore((s) => s.crf);
  const fastStart      = useStore((s) => s.fastStart);
  const videoBitrate   = useStore((s) => s.videoBitrate);
  const audioBitrate   = useStore((s) => s.audioBitrate);
  const brightness     = useStore((s) => s.brightness);
  const contrast       = useStore((s) => s.contrast);
  const volume         = useStore((s) => s.volume);
  const isExporting    = useStore((s) => s.isExporting);
  const jobProgress    = useStore((s) => s.jobProgress);
  const downloadReady  = useStore((s) => s.downloadReady);
  const activeFileId   = useStore((s) => s.activeFileId);
  const activeFile     = useStore((s) => s.activeFile);
  const currentJob     = useStore((s) => s.currentJob);
  const getDownloadLink = useStore((s) => s.getDownloadLink);
  const cancelCurrentJob = useStore((s) => s.cancelCurrentJob);

  const setTrimStart    = useStore((s) => s.setTrimStart);
  const setTrimDuration = useStore((s) => s.setTrimDuration);
  const setResizeWidth  = useStore((s) => s.setResizeWidth);
  const setResizeHeight = useStore((s) => s.setResizeHeight);
  const setKeepAspect   = useStore((s) => s.setKeepAspect);
  const setOutputFormat = useStore((s) => s.setOutputFormat);
  const setVideoCodec   = useStore((s) => s.setVideoCodec);
  const setAudioCodec   = useStore((s) => s.setAudioCodec);
  const setRemoveAudio  = useStore((s) => s.setRemoveAudio);
  const setPreset       = useStore((s) => s.setPreset);
  const setCrf          = useStore((s) => s.setCrf);
  const setVideoBitrate = useStore((s) => s.setVideoBitrate);
  const setAudioBitrate = useStore((s) => s.setAudioBitrate);
  const setFastStart    = useStore((s) => s.setFastStart);
  const setBrightness   = useStore((s) => s.setBrightness);
  const setContrast     = useStore((s) => s.setContrast);
  const setVolume       = useStore((s) => s.setVolume);
  const handleExport    = useStore((s) => s.handleExport);

  const [systemMetrics, setSystemMetrics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const sample = async () => {
      let next = {};

      try {
        const response = await getMetricsSystem();
        if (response && typeof response === 'object') {
          next = response;
        }
      } catch (error) {
        if (error?.response?.status !== 404) {
          next = {};
        }
      }

      if (performance?.memory) {
        next = {
          ...next,
          proc_memory_mb: next.proc_memory_mb ?? (performance.memory.usedJSHeapSize / (1024 * 1024)),
          heap_limit_mb: performance.memory.jsHeapSizeLimit / (1024 * 1024),
        };
      }

      if (!cancelled) setSystemMetrics(next);
    };

    void sample();
    timer = window.setInterval(sample, 2000);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const progressPct = Math.round(jobProgress * 100);
  const jobElapsed = currentJob?.elapsed_secs > 0 ? `${currentJob.elapsed_secs.toFixed(1)}s` : '...';
  const jobStrategy = currentJob?.strategy || (isExporting ? 'processing' : '-');
  const jobStage = currentJob?.stage || currentJob?.status || (isExporting ? 'working' : 'idle');
  const heapUsed = systemMetrics?.proc_memory_mb > 0 ? `${systemMetrics.proc_memory_mb.toFixed(0)} MB` : 'N/A';
  const cpuUsed = systemMetrics?.cpu_percent >= 0 ? `${systemMetrics.cpu_percent.toFixed(0)}%` : 'N/A';
  const systemRamUsed = systemMetrics?.ram_used_mb > 0 && systemMetrics?.ram_total_mb > 0
    ? `${systemMetrics.ram_used_mb.toFixed(0)} / ${systemMetrics.ram_total_mb.toFixed(0)} MB`
    : 'N/A';
  const gpuUsed = systemMetrics?.gpu
    ? systemMetrics.gpu.util_percent >= 0
      ? `${systemMetrics.gpu.util_percent.toFixed(0)}%`
      : (systemMetrics.gpu.name || 'available')
    : 'N/A';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <svg className="w-4 h-4" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
        </svg>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Controls</h2>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        <Section
          title="Live Job"
          accent="#f59e0b"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        >
          <div className="grid grid-cols-2 gap-2">
            <InfoPill label="Stage" value={jobStage} tone="accent" />
            <InfoPill label="Strategy" value={jobStrategy} tone={jobStrategy === 'stream_copy' ? 'success' : 'default'} />
            <InfoPill label="Elapsed" value={jobElapsed} />
            <InfoPill label="Progress" value={`${progressPct}%`} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <InfoPill label="Process heap" value={heapUsed} />
            <InfoPill label="CPU" value={cpuUsed} />
            <InfoPill label="System RAM" value={systemRamUsed} />
            <InfoPill label="GPU" value={gpuUsed} />
          </div>

          {!!currentJob?.logs?.length && (
            <div className="rounded-lg border p-2 max-h-28 overflow-y-auto" style={{ background: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border)' }}>
              <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Latest logs</div>
              <div className="space-y-1">
                {currentJob.logs.slice(-4).map((line) => (
                  <div key={line} className="text-[10px] font-mono leading-4 break-words" style={{ color: 'var(--color-text-secondary)' }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isExporting && (
            <button
              type="button"
              onClick={cancelCurrentJob}
              className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.18)' }}
            >
              Cancel current job
            </button>
          )}
        </Section>

        <Divider />

        <Section
          title="Trim"
          accent="#f59e0b"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
        >
          <NumberField id="trim-start-input" label="Start (seconds)" value={trimStart} onChange={setTrimStart} placeholder="0" min={0} max={videoDuration} step={0.1} />
          <NumberField id="trim-duration-input" label="Duration (seconds)" value={trimDuration} onChange={setTrimDuration} placeholder="0" min={0} max={videoDuration} step={0.1} />
        </Section>

        <Divider />

        <Section
          title="Resize"
          accent="#fb923c"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>}
          defaultOpen={false}
        >
          {activeFile && activeFile.width > 0 && (
            <div
              className="px-3 py-2 rounded-lg text-xs flex items-center gap-2"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}
            >
              <span style={{ color: '#f59e0b' }}>⊞</span>
              <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{activeFile.width} × {activeFile.height}</span>
              {activeFile.fileSize && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {activeFile.fileSize < 1024*1024 ? `${(activeFile.fileSize/1024).toFixed(1)} KB` : `${(activeFile.fileSize/(1024*1024)).toFixed(1)} MB`}
                </span>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="resize-width-input" label="Width" value={resizeWidth} onChange={setResizeWidth} placeholder={activeFile?.width || 'Auto'} min={0} />
            <NumberField id="resize-height-input" label="Height" value={resizeHeight} onChange={setResizeHeight} placeholder={activeFile?.height || 'Auto'} min={0} />
          </div>
          <ToggleField id="keep-aspect-toggle" label="Keep aspect ratio" checked={keepAspect} onChange={setKeepAspect} />
        </Section>

        <Divider />

        <Section
          title="Output"
          accent="#22c55e"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>}
        >
          <SelectField id="output-format-select" label="Format" value={outputFormat} onChange={setOutputFormat} options={FORMATS} />
          <SelectField id="video-codec-select" label="Video Codec" value={videoCodec} onChange={setVideoCodec} options={VIDEO_CODECS} />
          <SelectField id="audio-codec-select" label="Audio Codec" value={audioCodec} onChange={setAudioCodec} options={AUDIO_CODECS} />
          <SelectField id="preset-select" label="Preset" value={preset} onChange={setPreset} options={PRESETS} />
        </Section>

        <Divider />

        <Section
          title="Quality"
          accent="#fbbf24"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>}
          defaultOpen={false}
        >
          <SliderField label="CRF" min={18} max={35} step={1} value={crf} onChange={setCrf} />
          <div className="flex justify-between text-[9px] -mt-2" style={{ color: 'var(--color-text-muted)' }}>
            <span>High quality</span><span>Small size</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField id="vid-bitrate" label="Video Bitrate" value={videoBitrate} onChange={setVideoBitrate} placeholder="Auto (e.g. 5M)" />
            <TextField id="aud-bitrate" label="Audio Bitrate" value={audioBitrate} onChange={setAudioBitrate} placeholder="Auto (e.g. 192k)" />
          </div>
        </Section>

        <Divider />

        <Section
          title="Effects"
          accent="#ec4899"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>}
          defaultOpen={false}
        >
          <SliderField
            label="Brightness"
            min={-1} max={1} step={0.05}
            value={brightness} onChange={setBrightness}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
          />
          <SliderField
            label="Contrast"
            min={0.1} max={2.0} step={0.05}
            value={contrast} onChange={setContrast}
            format={(v) => v.toFixed(2)}
          />
          <SliderField
            label="Volume"
            min={0} max={2.0} step={0.05}
            value={volume} onChange={setVolume}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Section>

        <Divider />

        <Section
          title="Audio"
          accent="#ef4444"
          icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>}
          defaultOpen={false}
        >
          <ToggleField id="remove-audio-toggle" label="Remove audio" checked={removeAudio} onChange={setRemoveAudio} />
          <ToggleField id="fast-start-toggle" label="Fast start (MP4)" checked={fastStart} onChange={setFastStart} />
        </Section>

      </div>

      {/* Export Area */}
      <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        {/* Progress bar */}
        {isExporting && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Exporting</span>
              <span className="text-[11px] font-mono" style={{ color: '#f59e0b' }}>{progressPct}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fb923c)',
                  boxShadow: '0 0 8px rgba(245,158,11,0.5)',
                }}
              />
            </div>
          </div>
        )}

        {/* Export button */}
        <button
          id="export-btn"
          disabled={!activeFileId || isExporting}
          onClick={handleExport}
          className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
          style={
            isExporting
              ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', cursor: 'wait' }
              : !activeFileId
              ? { background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', cursor: 'not-allowed' }
              : {
                  background: 'linear-gradient(135deg, #f59e0b, #fb923c)',
                  color: '#000',
                  boxShadow: '0 4px 14px rgba(245,158,11,0.35)',
                  cursor: 'pointer',
                }
          }
          onMouseEnter={(e) => { if (activeFileId && !isExporting) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(245,158,11,0.45)'; } }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = activeFileId && !isExporting ? '0 4px 14px rgba(245,158,11,0.35)' : ''; }}
        >
          {isExporting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Processing…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Export
            </span>
          )}
        </button>

        {/* Download */}
        {downloadReady && (
          <a
            id="download-btn"
            href={getDownloadLink()}
            download
            className="flex items-center justify-center gap-2 w-full mt-2 py-2.5 rounded-xl text-sm font-semibold transition-all animate-fade-in"
            style={{
              background: 'rgba(34,197,94,0.1)',
              color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.2)',
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </a>
        )}
      </div>
    </div>
  );
}
