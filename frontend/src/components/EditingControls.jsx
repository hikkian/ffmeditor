import useStore from '../store';
import { clamp } from '../utils/helpers';

const FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'mp3', 'aac', 'wav', 'flac', 'ogg', 'avi', 'm4a'];
const VIDEO_CODECS = ['copy', 'libx264', 'libx265', 'libvpx-vp9'];
const AUDIO_CODECS = ['copy', 'aac', 'libmp3lame', 'libopus', 'flac'];
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

function SelectField({ id, label, value, onChange, options }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function NumberField({ id, label, value, onChange, placeholder, min, max, step }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-2 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all"
      />
    </div>
  );
}

function ToggleField({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between cursor-pointer group">
      <span className="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
        {label}
      </span>
      <div className="relative">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-9 h-5 rounded-full transition-colors ${checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)] border border-[var(--color-border)]'}`}>
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
      </div>
    </label>
  );
}

export default function EditingControls() {
  const trimStart = useStore((s) => s.trimStart);
  const trimDuration = useStore((s) => s.trimDuration);
  const videoDuration = useStore((s) => s.videoDuration);
  const resizeWidth = useStore((s) => s.resizeWidth);
  const resizeHeight = useStore((s) => s.resizeHeight);
  const keepAspect = useStore((s) => s.keepAspect);
  const outputFormat = useStore((s) => s.outputFormat);
  const videoCodec = useStore((s) => s.videoCodec);
  const audioCodec = useStore((s) => s.audioCodec);
  const removeAudio = useStore((s) => s.removeAudio);
  const preset = useStore((s) => s.preset);
  const crf = useStore((s) => s.crf);
  const fastStart = useStore((s) => s.fastStart);
  const videoBitrate = useStore((s) => s.videoBitrate);
  const audioBitrate = useStore((s) => s.audioBitrate);
  const brightness = useStore((s) => s.brightness);
  const contrast = useStore((s) => s.contrast);
  const volume = useStore((s) => s.volume);

  const isExporting = useStore((s) => s.isExporting);
  const jobProgress = useStore((s) => s.jobProgress);
  const downloadReady = useStore((s) => s.downloadReady);
  const activeFileId = useStore((s) => s.activeFileId);
  const activeFile = useStore((s) => s.activeFile);
  const getDownloadLink = useStore((s) => s.getDownloadLink);

  const setTrimStart = useStore((s) => s.setTrimStart);
  const setTrimDuration = useStore((s) => s.setTrimDuration);
  const setResizeWidth = useStore((s) => s.setResizeWidth);
  const setResizeHeight = useStore((s) => s.setResizeHeight);
  const setKeepAspect = useStore((s) => s.setKeepAspect);
  const setOutputFormat = useStore((s) => s.setOutputFormat);
  const setVideoCodec = useStore((s) => s.setVideoCodec);
  const setAudioCodec = useStore((s) => s.setAudioCodec);
  const setRemoveAudio = useStore((s) => s.setRemoveAudio);
  const setPreset = useStore((s) => s.setPreset);
  const setCrf = useStore((s) => s.setCrf);
  const setVideoBitrate = useStore((s) => s.setVideoBitrate);
  const setAudioBitrate = useStore((s) => s.setAudioBitrate);
  const setFastStart = useStore((s) => s.setFastStart);
  const setBrightness = useStore((s) => s.setBrightness);
  const setContrast = useStore((s) => s.setContrast);
  const setVolume = useStore((s) => s.setVolume);
  const handleExport = useStore((s) => s.handleExport);

  const normalizedProgress = jobProgress > 1 ? jobProgress / 100 : jobProgress;
  const progressPct = Math.round(Math.max(0, Math.min(normalizedProgress, 1)) * 100);

  const handleTrimStartChange = (value) => {
    const numericValue = Number(value) || 0;
    const nextStart = clamp(numericValue, 0, videoDuration || 0);
    const maxDuration = Math.max(0, (videoDuration || 0) - nextStart);

    setTrimStart(nextStart);

    if (trimDuration > maxDuration) {
      setTrimDuration(maxDuration);
    }
  };

  const handleTrimDurationChange = (value) => {
    const numericValue = Number(value) || 0;
    const maxDuration = Math.max(0, (videoDuration || 0) - trimStart);
    const nextDuration = clamp(numericValue, 0.5, maxDuration);

    setTrimDuration(nextDuration);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
        <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Controls</h2>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Trim Section */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Trim</span>
          </div>
          <div className="space-y-3">
            <NumberField
              id="trim-start-input"
              label="Start (seconds)"
              value={trimStart}
              onChange={handleTrimStartChange}
              placeholder="0"
              min={0}
              max={videoDuration}
              step={0.1}
            />
            <NumberField
              id="trim-duration-input"
              label="Duration (seconds)"
              value={trimDuration}
              onChange={handleTrimDurationChange}
              placeholder="0"
              min={0}
              max={videoDuration}
              step={0.1}
            />
          </div>
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Resize */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Resize</span>
          </div>
          {/* Source info badge */}
          {activeFile && activeFile.width > 0 && (
            <div className="mb-2 px-2.5 py-1.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Source</span>
                <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">{activeFile.width}×{activeFile.height}</span>
                {activeFile.fileSize && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {activeFile.fileSize < 1024 * 1024
                      ? `${(activeFile.fileSize / 1024).toFixed(1)} KB`
                      : `${(activeFile.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <NumberField
              id="resize-width-input"
              label="New Width"
              value={resizeWidth}
              onChange={setResizeWidth}
              placeholder={activeFile?.width || 'Auto'}
              min={0}
            />
            <NumberField
              id="resize-height-input"
              label="New Height"
              value={resizeHeight}
              onChange={setResizeHeight}
              placeholder={activeFile?.height || 'Auto'}
              min={0}
            />
          </div>
          <ToggleField id="keep-aspect-toggle" label="Keep aspect ratio" checked={keepAspect} onChange={setKeepAspect} />
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Output */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Output</span>
          </div>
          <div className="space-y-3">
            <SelectField id="output-format-select" label="Format" value={outputFormat} onChange={setOutputFormat} options={FORMATS} />
            <SelectField id="video-codec-select" label="Video Codec" value={videoCodec} onChange={setVideoCodec} options={VIDEO_CODECS} />
            <SelectField id="audio-codec-select" label="Audio Codec" value={audioCodec} onChange={setAudioCodec} options={AUDIO_CODECS} />
            <SelectField id="preset-select" label="Preset" value={preset} onChange={setPreset} options={PRESETS} />
          </div>
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Quality */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Quality</span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="crf-slider" className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">CRF</label>
                <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{crf}</span>
              </div>
              <input
                id="crf-slider"
                type="range"
                min={18}
                max={35}
                value={crf}
                onChange={(e) => setCrf(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-0.5">
                <span>High quality</span>
                <span>Small size</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <label htmlFor="vid-bitrate" className="block text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  Video Bitrate (e.g. 5M)
                </label>
                <input
                  id="vid-bitrate"
                  type="text"
                  value={videoBitrate}
                  onChange={(e) => setVideoBitrate(e.target.value)}
                  placeholder="Auto"
                  className="w-full px-3 py-2 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all"
                />
              </div>
              <div>
                <label htmlFor="aud-bitrate" className="block text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  Audio Bitrate (e.g. 192k)
                </label>
                <input
                  id="aud-bitrate"
                  type="text"
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(e.target.value)}
                  placeholder="Auto"
                  className="w-full px-3 py-2 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Effects & Filters */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Effects</span>
          </div>
          <div className="space-y-3">
            {/* Brightness */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Brightness</label>
                <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{brightness > 0 ? '+' : ''}{brightness.toFixed(2)}</span>
              </div>
              <input type="range" min={-1} max={1} step={0.05} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full" />
            </div>
            {/* Contrast */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Contrast</label>
                <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{contrast.toFixed(2)}</span>
              </div>
              <input type="range" min={0.1} max={2.0} step={0.05} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full" />
            </div>
            {/* Volume */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Volume</label>
                <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{Math.round(volume * 100)}%</span>
              </div>
              <input type="range" min={0} max={2.0} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full" />
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Audio Options */}
        <div>
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Audio</span>
          </div>
          <div className="space-y-2">
            <ToggleField id="remove-audio-toggle" label="Remove audio" checked={removeAudio} onChange={setRemoveAudio} />
            <ToggleField id="fast-start-toggle" label="Fast start (MP4)" checked={fastStart} onChange={setFastStart} />
          </div>
        </div>
      </div>

      {/* Export Area */}
      <div className="p-4 border-t border-[var(--color-border)]">
        {/* Progress */}
        {isExporting && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Exporting</span>
              <span className="text-[11px] font-mono text-[var(--color-accent)]">{progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-purple)] rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Export Button */}
        <button
          id="export-btn"
          disabled={!activeFileId || isExporting}
          onClick={handleExport}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
            isExporting
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] cursor-wait animate-pulse-glow'
              : !activeFileId
              ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] cursor-not-allowed'
              : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:scale-[0.99]'
          }`}
        >
          {isExporting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Processing...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            className="flex items-center justify-center gap-2 w-full mt-2 py-2.5 rounded-xl text-sm font-semibold bg-[var(--color-success-muted)] text-[var(--color-success)] border border-[var(--color-success)]/20 hover:bg-[var(--color-success)]/20 transition-all"
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
