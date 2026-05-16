import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store';
import { debugLog, debugError } from '../utils/debug';

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
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const canRecordScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  const onStartRecording = async (type) => {
    debugLog('MediaLibrary.onStartRecording', 'requested', {
      type,
      canRecordScreen,
    });
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera recording is not supported in this browser');
      }
      if (type === 'screen' && !canRecordScreen) {
        throw new Error('Screen recording is not supported in this browser');
      }

      stream = type === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

      const mimeType = [
        'video/webm;codecs=vp8',
        'video/webm;codecs=vp9',
        'video/webm',
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      debugLog('MediaLibrary.onStartRecording', 'media recorder created', {
        mimeType: mimeType || 'default',
      });
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        debugLog('MediaLibrary.onStartRecording', 'chunk received', {
          size: e.data?.size || 0,
        });
        chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        debugLog('MediaLibrary.onStartRecording', 'recording stopped', {
          chunkCount: chunks.length,
        });
        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        const file = new File([blob], `Recording_${Date.now()}.webm`, { type: blob.type });
        handleUpload(file);
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        recorderRef.current = null;
      };
      mediaRecorder.start();
      setIsRecording(true);
      recorderRef.current = mediaRecorder;
    } catch (err) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      debugError('MediaLibrary.onStartRecording', 'failed', {
        message: err?.message || 'Unknown error',
        name: err?.name || null,
      });
      const msg = err?.name === 'NotAllowedError'
        ? 'Permission denied. Allow camera/screen access and try again.'
        : `Recording failed: ${err?.message || 'Unknown error'}`;
      useStore.getState().setError(msg);
    }
  };

  const onStopRecording = () => {
    debugLog('MediaLibrary.onStopRecording', 'requested');
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  };

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    debugLog('MediaLibrary.onDrop', 'files dropped', {
      count: droppedFiles.length,
      names: droppedFiles.map((file) => file.name),
    });
    if (droppedFiles.length > 0) {
      handleUpload(droppedFiles[0]);
    }
  }, [handleUpload]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    debugLog('MediaLibrary.onFileSelect', 'selected', {
      name: file?.name || null,
      size: file?.size || 0,
      type: file?.type || null,
    });
    if (file) handleUpload(file);
  }, [handleUpload]);

  const formatDuration = (secs) => {
    if (!secs) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="flex flex-col h-full">
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
              <button
                onClick={() => onStartRecording('camera')}
                title="Record Camera"
                className="p-1 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-purple)] hover:text-white text-[var(--color-text-secondary)] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              </button>
              <button
                onClick={() => onStartRecording('screen')}
                title="Record Screen"
                disabled={!canRecordScreen}
                className="p-1 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)] hover:text-white text-[var(--color-text-secondary)] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={onStopRecording}
              className="px-2 py-1 flex items-center gap-1 rounded bg-[var(--color-error)]/20 text-[var(--color-error)] text-[10px] font-bold uppercase tracking-wider animate-pulse hover:bg-[var(--color-error)]/40 transition-colors"
            >
              <div className="w-2 h-2 rounded-full bg-[var(--color-error)]" /> Stop
            </button>
          )}
          <span className="text-xs text-[var(--color-text-muted)]">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div
        className={`mx-3 mt-3 mb-2 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-light)]'
        }`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        id="upload-drop-zone"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
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
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-purple)] rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
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

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {files.map((file) => (
          <div
            key={file.id}
            className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
              activeFileId === file.id
                ? 'bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30'
                : 'hover:bg-[var(--color-bg-hover)] border border-transparent'
            }`}
            onClick={() => selectFile(file.id)}
            onDoubleClick={() => debugLog('MediaLibrary.fileItem', 'double click', { fileId: file.id })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectFile(file.id);
              }
            }}
          >
            <button
              className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                debugLog('MediaLibrary.fileItem', 'toggle selection', { fileId: file.id });
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

            <div className="w-10 h-7 rounded bg-[var(--color-bg-tertiary)] flex items-center justify-center flex-shrink-0 overflow-hidden">
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
              </svg>
            </div>

            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="text-xs font-medium text-[var(--color-text-primary)] truncate leading-tight">{file.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">{formatDuration(file.duration)}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] opacity-30 flex-shrink-0">·</span>
                <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">{formatFileSize(file.fileSize)}</span>
                {file.width > 0 && (
                  <>
                    <span className="text-[10px] text-[var(--color-text-muted)] opacity-30 flex-shrink-0">·</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0 truncate">{file.width}×{file.height}</span>
                  </>
                )}
                {file.videoCodec && (
                  <span className="text-[9px] uppercase font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)] px-1 rounded flex-shrink-0 ml-0.5 truncate max-w-[48px]">{file.videoCodec}</span>
                )}
              </div>
            </div>

            <button
              className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)] transition-all"
              onClick={(e) => {
                e.stopPropagation();
                debugLog('MediaLibrary.fileItem', 'remove file clicked', { fileId: file.id });
                removeFile(file.id);
              }}
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
            <div className="w-12 h-12 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">No media files yet</p>
          </div>
        )}
      </div>

      {selectedFileIds.length >= 2 && (
        <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
          <button
            onClick={handleMerge}
            className="w-full py-2 rounded-lg text-xs font-semibold bg-[var(--color-purple-muted)] text-[var(--color-purple)] border border-[var(--color-purple)]/20 hover:bg-[var(--color-purple)]/20 transition-all flex justify-center items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            Merge {selectedFileIds.length} Files
          </button>
        </div>
      )}
    </div>
  );
}
