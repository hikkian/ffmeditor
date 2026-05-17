import { useCallback, useState } from 'react';
import useStore from '../store';

function FileTypeIcon({ file }) {
  const isAudio = file.name && /\.(mp3|aac|wav|flac|ogg|m4a)$/i.test(file.name);
  const color = isAudio ? '#fb923c' : '#f59e0b';
  return (
    <div
      className="w-10 h-7 rounded flex items-center justify-center flex-shrink-0"
      style={{ background: isAudio ? 'rgba(251,146,60,0.12)' : 'rgba(245,158,11,0.12)' }}
    >
      {isAudio ? (
        <svg className="w-4 h-4" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
        </svg>
      )}
    </div>
  );
}

export default function MediaLibrary() {
  const files           = useStore((s) => s.files);
  const activeFileId    = useStore((s) => s.activeFileId);
  const outputFormat    = useStore((s) => s.outputFormat);
  const selectFile      = useStore((s) => s.selectFile);
  const removeFile      = useStore((s) => s.removeFile);
  const handleUpload    = useStore((s) => s.handleUpload);
  const isUploading     = useStore((s) => s.isUploading);
  const uploadProgress  = useStore((s) => s.uploadProgress);
  const selectedFileIds = useStore((s) => s.selectedFileIds);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const handleMerge     = useStore((s) => s.handleMerge);
  const audioOnlyFormat = ['mp3', 'aac', 'wav', 'flac', 'ogg', 'm4a'].includes(String(outputFormat || '').toLowerCase());

  const [isDragOver, setIsDragOver]     = useState(false);
  const [isRecording, setIsRecording]   = useState(false);

  const onStartRecording = async (type) => {
    try {
      const stream = type === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        handleUpload(new File([blob], `Recording_${Date.now()}.webm`, { type: 'video/webm' }));
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
      };
      mediaRecorder.start();
      setIsRecording(true);
      window._activeRecorder = mediaRecorder;
    } catch (err) {
      console.error('Recording failed:', err);
    }
  };

  const onStopRecording = () => {
    if (window._activeRecorder) { window._activeRecorder.stop(); window._activeRecorder = null; }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault(); setIsDragOver(false);
    const f = Array.from(e.dataTransfer.files);
    if (f.length > 0) handleUpload(f[0]);
  }, [handleUpload]);

  const onDragOver  = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
  const onDragLeave = useCallback(() => setIsDragOver(false), []);
  const onFileSelect = useCallback((e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }, [handleUpload]);

  const formatDuration = (s) => {
    if (!s) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };
  const formatFileSize = (b) => {
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Media</h2>
        </div>
        <div className="flex items-center gap-2">
          {!isRecording ? (
            <div className="flex gap-1">
              <button
                onClick={() => onStartRecording('camera')}
                title="Record Camera"
                className="p-1.5 rounded transition-colors"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(251,146,60,0.15)'; e.currentTarget.style.color = '#fb923c'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              </button>
              <button
                onClick={() => onStartRecording('screen')}
                title="Record Screen"
                className="p-1.5 rounded transition-colors"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.15)'; e.currentTarget.style.color = '#f59e0b'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={onStopRecording}
              className="px-2 py-1 flex items-center gap-1 rounded text-[10px] font-bold uppercase tracking-wider animate-recording"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <div className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} /> Stop
            </button>
          )}
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        className="mx-3 mt-3 mb-2 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200"
        style={{
          borderColor: isDragOver ? '#f59e0b' : 'var(--color-border)',
          background: isDragOver ? 'rgba(245,158,11,0.06)' : 'transparent',
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => document.getElementById('file-upload-input')?.click()}
        id="upload-drop-zone"
      >
        <input id="file-upload-input" type="file" accept="video/*,audio/*" className="hidden" onChange={onFileSelect} />
        <div className="flex flex-col items-center justify-center py-6 px-3">
          {isUploading ? (
            <div className="w-full px-2">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 animate-spin" style={{ color: '#f59e0b' }} fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Uploading {uploadProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #f59e0b, #fb923c)' }}
                />
              </div>
            </div>
          ) : (
            <>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-2 transition-all"
                style={{
                  background: isDragOver ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.08)',
                  boxShadow: isDragOver ? '0 0 16px rgba(245,158,11,0.25)' : 'none',
                }}
              >
                <svg
                  className="w-5 h-5 transition-transform"
                  style={{ color: '#f59e0b', transform: isDragOver ? 'scale(1.15)' : 'scale(1)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Drop media here</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>or click to browse</p>
            </>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {files.map((file) => (
          <div
            key={file.id}
            className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
            style={{
              background: activeFileId === file.id ? 'rgba(245,158,11,0.1)' : 'transparent',
              border: activeFileId === file.id ? '1px solid rgba(245,158,11,0.22)' : '1px solid transparent',
            }}
            onClick={() => selectFile(file.id)}
            onMouseEnter={(e) => { if (activeFileId !== file.id) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
            onMouseLeave={(e) => { if (activeFileId !== file.id) e.currentTarget.style.background = 'transparent'; }}
          >
            {/* Checkbox */}
            <button
              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); toggleSelection(file.id); }}
            >
              <div
                className="w-3.5 h-3.5 rounded flex items-center justify-center transition-all"
                style={
                  selectedFileIds.includes(file.id)
                    ? { background: 'linear-gradient(135deg, #f59e0b, #fb923c)', border: 'none' }
                    : { border: '1px solid var(--color-border)' }
                }
              >
                {selectedFileIds.includes(file.id) && (
                  <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>

            {/* Icon */}
            <FileTypeIcon file={file} />

            {/* Info */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-xs font-medium truncate leading-tight" style={{ color: 'var(--color-text-primary)' }}>{file.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{formatDuration(file.duration)}</span>
                <span className="text-[10px] opacity-40 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>·</span>
                <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{formatFileSize(file.fileSize)}</span>
                {file.width > 0 && (
                  <span className="text-[10px] flex-shrink-0" style={{ color: '#f59e0b' }}>{file.width}×{file.height}</span>
                )}
                {file.videoCodec && (
                  <span className="text-[9px] uppercase font-mono flex-shrink-0 truncate" style={{ color: '#fb923c', maxWidth: 48 }}>{file.videoCodec}</span>
                )}
              </div>
            </div>

            {/* Remove */}
            <button
              className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center transition-all"
              style={{ color: 'var(--color-text-muted)' }}
              onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = ''; }}
              title="Remove"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {files.length === 0 && !isUploading && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'var(--color-bg-tertiary)' }}>
              <svg className="w-6 h-6" style={{ color: 'var(--color-text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No media files yet</p>
          </div>
        )}
      </div>

      {/* Merge */}
      {selectedFileIds.length >= 2 && (
        <div className="p-3 animate-fade-in flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)' }}>
          <button
            disabled={audioOnlyFormat}
            onClick={handleMerge}
            className="w-full py-2 rounded-lg text-xs font-bold flex justify-center items-center gap-2 transition-all"
            style={{
              background: audioOnlyFormat ? 'var(--color-bg-tertiary)' : 'linear-gradient(135deg, #f59e0b, #fb923c)',
              color: audioOnlyFormat ? 'var(--color-text-muted)' : '#000',
              boxShadow: audioOnlyFormat ? 'none' : '0 3px 10px rgba(245,158,11,0.28)',
              cursor: audioOnlyFormat ? 'not-allowed' : 'pointer',
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            {audioOnlyFormat ? 'Merge unavailable for audio-only' : `Merge ${selectedFileIds.length} Files`}
          </button>
        </div>
      )}
    </div>
  );
}
