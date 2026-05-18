import { useEffect, useRef, useState } from 'react';
import api from '../api';

const POLL_INTERVAL = 3000; // ms

function formatMB(value, digits = 0) {
  if (value === null || value === undefined || value < 0) return 'N/A';
  return `${value.toFixed(digits)} MB`;
}

function MetricCard({ label, value, hint, tone = 'default', compact = false }) {
  const tones = {
    default: 'from-[var(--color-bg-tertiary)] to-[var(--color-bg-elevated)]',
    accent: 'from-[rgba(245,158,11,0.14)] to-[rgba(245,158,11,0.05)]',
    success: 'from-[rgba(34,197,94,0.14)] to-[rgba(34,197,94,0.05)]',
  };

  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-gradient-to-br ${tones[tone]} ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} transition-colors hover:border-[var(--color-accent-border)]`}>
      <p className={`uppercase tracking-wider text-[8.5px] text-[var(--color-text-muted)]`}>{label}</p>
      <p className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-0.5 text-[12px]'} font-semibold text-[var(--color-text-primary)] truncate`} title={value}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[9px] text-[var(--color-text-muted)] truncate">{hint}</p>}
    </div>
  );
}

function StatRow({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between py-0.5 border-b border-[var(--color-border)] last:border-0">
      <span className="text-[9px] text-[var(--color-text-muted)]">{label}</span>
      <span className={`text-[10px] ${mono ? 'font-mono' : ''} text-[var(--color-text-secondary)]`}>{value}</span>
    </div>
  );
}

function OpLine({ op }) {
  const ok = op.success;
  const time = op.processing_time_sec?.toFixed(2) ?? '?';
  const speed = op.speed_ratio > 0 ? `${op.speed_ratio.toFixed(2)}x` : '-';
  const cpu = op.avg_cpu_percent > 0 ? `${op.avg_cpu_percent.toFixed(0)}%` : '-';
  const ram = op.peak_ram_mb > 0 ? `${op.peak_ram_mb.toFixed(0)} MB` : '-';
  const inMB = op.input_size_mb > 0 ? `${op.input_size_mb.toFixed(1)} MB` : '-';
  const outMB = op.output_size_mb > 0 ? `${op.output_size_mb.toFixed(1)} MB` : '-';
  const strategy = op.strategy || '-';
  const ffmpegSpeed = op.ffmpeg_speed > 0 ? `${op.ffmpeg_speed.toFixed(2)}x` : '-';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2.5 py-2">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-medium text-[var(--color-text-primary)] truncate">{op.operation}</span>
          <span className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider truncate">{op.output_format || '-'}</span>
          <span className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider truncate">{strategy}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-[var(--color-text-muted)]">
          <span>{time}s</span>
          <span>{speed}</span>
          <span>{cpu}</span>
          <span>{ram}</span>
          <span>{inMB} in</span>
          <span>{outMB} out</span>
          <span>{ffmpegSpeed} ffmpeg</span>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-[9px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{children}</p>;
}

function StatusPill({ label, value, tone = 'default' }) {
  const tones = {
    default: 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]',
    accent: 'border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.08)] text-[var(--color-accent)]',
    success: 'border-[rgba(34,197,94,0.18)] bg-[rgba(34,197,94,0.08)] text-[var(--color-success)]',
  };

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${tones[tone]}`}>
      <span className="text-[8.5px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="text-[10px] font-mono font-semibold">{value}</span>
    </div>
  );
}

export default function MetricsPanel({ onClose }) {
  const panelRef = useRef(null);
  const [snap, setSnap] = useState(null);
  const [ops, setOps] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [panelWidth, setPanelWidth] = useState(0);
  const timerRef = useRef(null);

  const fetchAll = async () => {
    try {
      const [snapRes, opsRes, sumRes] = await Promise.allSettled([
        api.get('/metrics/system/current'),
        api.get('/metrics/operations'),
        api.get('/metrics/summary'),
      ]);
      if (snapRes.status === 'fulfilled') setSnap(snapRes.value.data);
      if (opsRes.status === 'fulfilled') setOps(opsRes.value.data.operations ?? []);
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data);
    } catch {
      // individual requests can fail independently
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!panelRef.current || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width || 0;
      setPanelWidth(nextWidth);
    });

    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  const gpu = snap?.gpu;
  const cpuVal = snap?.cpu_percent ?? -1;
  const ramUsed = snap?.ram_used_mb ?? -1;
  const ramTotal = snap?.ram_total_mb ?? -1;
  const ramPercent = snap?.ram_percent ?? -1;
  const procMem = snap?.proc_memory_mb ?? -1;
  const gpuUtil = gpu?.available && gpu?.util_percent >= 0 ? `${gpu.util_percent.toFixed(0)}%` : 'Not detected';
  const latestOps = ops.slice(0, 5);
  const activeOps = summary?.total_operations ?? ops.length ?? 0;
  const successRate = `${summary?.success_rate_percent?.toFixed(1) ?? 0}%`;
  const refreshLabel = `${POLL_INTERVAL / 1000}s`;
  const veryNarrow = panelWidth > 0 && panelWidth < 360;
  const overviewCols = panelWidth > 0 && panelWidth >= 720 ? 'grid-cols-4' : panelWidth > 0 && panelWidth >= 420 ? 'grid-cols-2' : 'grid-cols-1';
  const sectionCols = panelWidth > 0 && panelWidth >= 700 ? 'grid-cols-2' : 'grid-cols-1';
  const statCols = panelWidth > 0 && panelWidth >= 360 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div ref={panelRef} className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--color-bg-secondary)] animate-fade-in">
      <div className="px-3.5 pt-3 pb-2 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[linear-gradient(135deg,rgba(245,158,11,0.20),rgba(251,146,60,0.10))] border border-[rgba(245,158,11,0.18)] shadow-[0_8px_18px_rgba(245,158,11,0.08)]">
              <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.18em] truncate">Performance Metrics</h2>
              <p className="text-[9px] text-[var(--color-text-muted)] truncate">Live system and export telemetry</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusPill label="Refresh" value={refreshLabel} />
            <StatusPill label="Ops" value={String(activeOps)} tone="accent" />
            <StatusPill label="GPU" value={gpu?.available ? 'Detected' : 'None'} tone={gpu?.available ? 'success' : 'default'} />
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-5.5 h-5.5 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg className="w-4.5 h-4.5 text-[var(--color-accent)] animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        ) : (
          <div className="h-full min-h-0 grid gap-3 auto-rows-min">
            <div className={`grid gap-2 ${overviewCols}`}>
              <MetricCard label="CPU" value={cpuVal >= 0 ? `${cpuVal.toFixed(1)}%` : 'N/A'} tone={cpuVal >= 70 ? 'accent' : 'default'} compact />
              <MetricCard label="RAM" value={ramTotal > 0 && ramUsed >= 0 ? `${ramUsed.toFixed(0)} / ${ramTotal.toFixed(0)} MB` : 'N/A'} hint={ramPercent >= 0 ? `${ramPercent.toFixed(1)}% used` : undefined} compact />
              <MetricCard label="Heap" value={formatMB(procMem)} hint="React / Node heap" compact />
              <MetricCard label="GPU" value={gpuUtil} hint={gpu?.available ? (gpu.source || 'telemetry') : 'No telemetry'} compact />
            </div>

            <div className={`grid gap-3 ${sectionCols}`}>
              <div className={`rounded-xl border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(245,158,11,0.08),rgba(245,158,11,0.03))] ${veryNarrow ? 'p-2.5' : 'p-3'}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <SectionTitle>Summary</SectionTitle>
                  <span className="text-[9px] text-[var(--color-text-muted)] truncate">{successRate} success</span>
                </div>
                <div className={`grid gap-2 ${statCols}`}>
                  <MetricCard label="Success" value={summary?.success_count ?? 0} tone="success" compact />
                  <MetricCard label="Failed" value={summary?.failure_count ?? 0} compact />
                  <MetricCard label="Avg time" value={`${summary?.avg_processing_time_sec?.toFixed(2) ?? '0.00'}s`} compact />
                  <MetricCard label="Speed" value={`${summary?.avg_speed_ratio?.toFixed(2) ?? '0.00'}x`} compact />
                </div>
                <div className={`mt-2 grid gap-x-3 gap-y-0.5 ${statCols}`}>
                  <StatRow label="Fastest" value={`${summary?.fastest_operation_sec?.toFixed(2) ?? '0.00'}s`} />
                  <StatRow label="Slowest" value={`${summary?.slowest_operation_sec?.toFixed(2) ?? '0.00'}s`} />
                  <StatRow label="Avg compression" value={`${summary?.avg_compression_pct?.toFixed(1) ?? '0.0'}%`} />
                  <StatRow label="Peak RAM" value={`${summary?.peak_ram_mb?.toFixed(0) ?? '0'} MB`} />
                </div>
              </div>

              <div className={`rounded-xl border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(34,197,94,0.08),rgba(34,197,94,0.03))] ${veryNarrow ? 'p-2.5' : 'p-3'}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <SectionTitle>Live</SectionTitle>
                  <span className="text-[9px] text-[var(--color-text-muted)] truncate">{gpu?.available ? 'GPU ready' : 'GPU absent'}</span>
                </div>
                <div className={`grid gap-2 ${statCols}`}>
                  <MetricCard label="Refresh" value={refreshLabel} compact />
                  <MetricCard label="Ops" value={activeOps} compact />
                  <MetricCard label="Process heap" value={formatMB(procMem)} compact />
                  <MetricCard label="System RAM" value={`${ramUsed >= 0 && ramTotal > 0 ? `${ramUsed.toFixed(0)} / ${ramTotal.toFixed(0)} MB` : 'N/A'}`} compact />
                </div>
                <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-2">
                  <div className="grid gap-1.5">
                    <StatRow label="GPU status" value={gpu?.available ? 'Detected' : 'Not detected'} />
                    <StatRow label="GPU source" value={gpu?.source || 'none'} />
                    <StatRow label="GPU name" value={gpu?.name || 'No adapter'} />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-3 min-h-0 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <SectionTitle>Latest operations</SectionTitle>
                <span className="text-[9px] text-[var(--color-text-muted)]">{ops.length} total</span>
              </div>
              {latestOps.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[10px] text-[var(--color-text-muted)]">No operations yet</p>
                </div>
              ) : (
                <div className="grid gap-1.5 overflow-hidden">
                  {latestOps.map((op) => <OpLine key={op.operation_id} op={op} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
