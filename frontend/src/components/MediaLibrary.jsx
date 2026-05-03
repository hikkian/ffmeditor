import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useStore from '../store';

export default function MediaLibrary() {
  const files = useStore((s) => s.files);
  const activeFileId = useStore((s) => s.activeFileId);
  const selectFile = useStore((s) => s.selectFile);
  const removeFile = useStore((s) => s.removeFile);
  const handleUpload = useStore((s) => s.handleUpload);
  const isUploading = useStore((s) => s.isUploading);
  const uploadProgress = useStore((s) => s.uploadProgress);
  const selectedFileIds = useStore((s) => s.selectedFileIds);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const handleMerge = useStore((s) => s.handleMerge);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

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
        const file = new File([blob], `Recording_${new Date().getTime()}.webm`, { type: 'video/webm' });
        handleUpload(file);
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
    if (window._activeRecorder) {
      window._activeRecorder.stop();
      window._activeRecorder = null;
    }
  };

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        handleUpload(droppedFiles[0]);
      }
    },
    [handleUpload]
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  const onFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const formatDuration = (secs) => {
    if (!secs) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 4V2h10v2M5 8h14l-1.5 12.5a2 2 0 01-2 1.5H8.5a2 2 0 01-2-1.5L5 8zM3 8h18M9 4h6" />
          </svg>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Media</h2>
        </div>
        
        <div className="flex items-center gap-2">
          {!isRecording ? (
            <div className="flex gap-1">
              <button onClick={() => onStartRecording('camera')} title="Record Camera" className="p-1 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-purple)] hover:text-white text-[var(--color-text-secondary)] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              </button>
              <button onClick={() => onStartRecording('screen')} title="Record Screen" className="p-1 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)] hover:text-white text-[var(--color-text-secondary)] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </button>
            </div>
          ) : (
            <button onClick={onStopRecording} className="px-2 py-1 flex items-center gap-1 rounded bg-[var(--color-error)]/20 text-[var(--color-error)] text-[10px] font-bold uppercase tracking-wider animate-pulse hover:bg-[var(--color-error)]/40 transition-colors">
              <div className="w-2 h-2 rounded-full bg-[var(--color-error)]" /> Stop
            </button>
          )}
          <span className="text-xs text-[var(--color-text-muted)]">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        className={`mx-3 mt-3 mb-2 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-light)]'
        }`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => document.getElementById('file-upload-input')?.click()}
        id="upload-drop-zone"
      >
        <input
          id="file-upload-input"
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={onFileSelect}
        />
        <div className="flex flex-col items-center justify-center py-6 px-3">
          {isUploading ? (
            <div className="w-full px-2">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-[var(--color-accent)] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="text-xs text-[var(--color-text-secondary)]">Uploading {uploadProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-purple)] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-muted)] flex items-center justify-center mb-2">
                <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">Drop media here</p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">or click to browse</p>
            </>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        <AnimatePresence>
          {files.map((file) => (
            <motion.div
              key={file.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                activeFileId === file.id
                  ? 'bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30'
                  : 'hover:bg-[var(--color-bg-hover)] border border-transparent'
              }`}
              onClick={() => selectFile(file.id)}
            >
              {/* Checkbox for Merge */}
              <button
                className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelection(file.id);
                }}
              >
                <div className={`w-3.5 h-3.5 rounded-sm border ${selectedFileIds.includes(file.id) ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'border-[var(--color-border)] group-hover:border-[var(--color-text-secondary)]'} flex items-center justify-center`}>
                  {selectedFileIds.includes(file.id) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>

              {/* Thumbnail */}
              <div className="w-10 h-7 rounded bg-[var(--color-bg-tertiary)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{file.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[var(--color-text-muted)]">{formatDuration(file.duration)}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">·</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{formatFileSize(file.fileSize)}</span>
                  {file.width > 0 && (
                    <>
                      <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">·</span>
                      <span className="text-[10px] text-[var(--color-accent)]">{file.width}×{file.height}</span>
                    </>
                  )}
                  {file.videoCodec && (
                    <>
                      <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">·</span>
                      <span className="text-[9px] uppercase font-mono text-[var(--color-purple)]">{file.videoCodec}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Remove */}
              <button
                className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)] transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(file.id);
                }}
                title="Remove"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {files.length === 0 && !isUploading && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">No media files yet</p>
          </div>
        )}
      </div>

      {/* Merge Action */}
      <AnimatePresence>
        {selectedFileIds.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-tertiary)]"
          >
            <button
              onClick={handleMerge}
              className="w-full py-2 rounded-lg text-xs font-semibold bg-[var(--color-purple-muted)] text-[var(--color-purple)] border border-[var(--color-purple)]/20 hover:bg-[var(--color-purple)]/20 transition-all flex justify-center items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              Merge {selectedFileIds.length} Files
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
