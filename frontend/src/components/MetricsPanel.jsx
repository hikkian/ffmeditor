import { useEffect, useRef, useState } from 'react';
import api from '../api';

const POLL_INTERVAL = 3000; // ms

function Gauge({ label, value, max, unit, color = 'accent', warn = 75, danger = 90 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const colorClass = pct >= danger
    ? 'var(--color-error)'
    : pct >= warn
    ? 'var(--color-warning)'
    : `var(--color-${color})`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">{label}</span>
        <span className="text-[11px] font-mono" style={{ color: colorClass }}>
          {value < 0 ? 'N/A' : `${value.toFixed(1)}${unit}`}
        </span>
      </div>
      <div className="w-full h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: colorClass }}
        />
      </div>
    </div>
  );
}

function StatRow({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-[var(--color-border)] last:border-0">
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
      <span className={`text-[11px] ${mono ? 'font-mono' : ''} text-[var(--color-text-secondary)]`}>{value}</span>
    </div>
  );
}

function OpRow({ op }) {
  const ok = op.success;
  const time = op.processing_time_sec?.toFixed(2) ?? '?';
  const speed = op.ffmpeg_speed > 0 ? `${op.ffmpeg_speed.toFixed(2)}×` : '-';
  const fps = op.ffmpeg_fps > 0 ? `${op.ffmpeg_fps.toFixed(1)}` : '-';
  const cpu = op.avg_cpu_percent > 0 ? `${op.avg_cpu_percent.toFixed(1)}%` : '-';
  const ram = op.peak_ram_mb > 0 ? `${op.peak_ram_mb.toFixed(0)} MB` : '-';
  const inMB = op.input_size_mb > 0 ? `${op.input_size_mb.toFixed(1)}` : '-';
  const outMB = op.output_size_mb > 0 ? `${op.output_size_mb.toFixed(1)}` : '-';
  const ratio = op.speed_ratio > 0 ? `${op.speed_ratio.toFixed(2)}×` : '-';

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-3 text-[11px]">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`}
        />
        <span className="font-medium text-[var(--color-text-primary)] truncate">{op.operation}</span>
        <span className="ml-auto font-mono text-[var(--color-accent)]">{time}s</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <StatRow label="Format" value={op.output_format || '-'} mono={false} />
        <StatRow label="Speed" value={ratio} />
        <StatRow label="FFmpeg ×" value={speed} />
        <StatRow label="FPS" value={fps} />
        <StatRow label="Avg CPU" value={cpu} />
        <StatRow label="Peak RAM" value={ram} />
        <StatRow label="In (MB)" value={inMB} />
        <StatRow label="Out (MB)" value={outMB} />
      </div>
      {!ok && op.error && (
        <p className="mt-2 text-[10px] text-[var(--color-error)] truncate" title={op.error}>
          {op.error}
        </p>
      )}
    </div>
  );
}

export default function MetricsPanel({ onClose }) {
  const [snap, setSnap] = useState(null);
  const [ops, setOps] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('live'); // 'live' | 'ops' | 'summary'
  const timerRef = useRef(null);

  const fetchAll = async () => {
    try {
      const [snapRes, opsRes, sumRes] = await Promise.allSettled([
        api.get('/metrics/system/current'),
        api.get('/metrics/operations'),
        api.get('/metrics/summary'),
      ]);
      if (snapRes.status === 'fulfilled') setSnap(snapRes.value.data);
      if (opsRes.status === 'fulfilled')  setOps(opsRes.value.data.operations ?? []);
      if (sumRes.status === 'fulfilled')  setSummary(sumRes.value.data);
    } catch {
      /* ignore individual failures */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  const gpu = snap?.gpu;
  const cpuVal = snap?.cpu_percent ?? -1;
  const ramUsed = snap?.ram_used_mb ?? 0;
  const ramTotal = snap?.ram_total_mb ?? 0;
  const procMem = snap?.proc_memory_mb ?? 0;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--color-purple)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Performance Metrics</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)] flex-shrink-0">
        {[
          { id: 'live', label: 'Live' },
          { id: 'ops', label: `Ops${ops.length ? ` (${ops.length})` : ''}` },
          { id: 'summary', label: 'Summary' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors ${
              tab === t.id
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <svg className="w-5 h-5 text-[var(--color-accent)] animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        )}

        {/* ── Live tab ── */}
        {!loading && tab === 'live' && (
          <div className="space-y-5">
            {/* CPU & RAM */}
            <div>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">System</p>
              <div className="space-y-3">
                <Gauge label="CPU" value={cpuVal} max={100} unit="%" warn={70} danger={90} />
                <Gauge label="RAM used" value={ramUsed} max={ramTotal > 0 ? ramTotal : 8192} unit=" MB" color="purple" warn={75} danger={90} />
                <Gauge label="Process heap" value={procMem} max={512} unit=" MB" color="accent" warn={200} danger={400} />
              </div>
              {ramTotal > 0 && (
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                  {ramUsed.toFixed(0)} / {ramTotal.toFixed(0)} MB RAM
                  {snap?.ram_percent > 0 && ` (${snap.ram_percent.toFixed(1)}%)`}
                </p>
              )}
            </div>

            {/* GPU */}
            <div>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">GPU</p>
              {gpu ? (
                <div className="space-y-3">
                  <p className="text-[10px] text-[var(--color-text-secondary)] mb-2 truncate" title={gpu.name}>{gpu.name}</p>
                  <Gauge label="GPU utilization" value={gpu.util_percent} max={100} unit="%" color="purple" />
                  <Gauge label="GPU memory" value={gpu.used_mb} max={gpu.total_mb || 8192} unit=" MB" color="purple" />
                  {gpu.temperature_c > 0 && (
                    <Gauge label="Temperature" value={gpu.temperature_c} max={95} unit="°C" warn={70} danger={85} />
                  )}
                  {gpu.total_mb > 0 && (
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {gpu.used_mb.toFixed(0)} / {gpu.total_mb.toFixed(0)} MB VRAM
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-3 py-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)]">
                  <p className="text-[10px] text-[var(--color-text-muted)]">GPU not available</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] opacity-70 mt-0.5">nvidia-smi not found</p>
                </div>
              )}
            </div>

            {/* Live indicator */}
            <div className="flex items-center gap-2 pt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
              <span className="text-[10px] text-[var(--color-text-muted)]">
                Refreshing every {POLL_INTERVAL / 1000}s
              </span>
            </div>
          </div>
        )}

        {/* ── Ops tab ── */}
        {!loading && tab === 'ops' && (
          <div className="space-y-3">
            {ops.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--color-text-muted)]">No operations yet</p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1 opacity-60">Export a file to record metrics</p>
              </div>
            ) : (
              [...ops].reverse().map((op) => <OpRow key={op.operation_id} op={op} />)
            )}
          </div>
        )}

        {/* ── Summary tab ── */}
        {!loading && tab === 'summary' && (
          <div className="space-y-4">
            {!summary || summary.total_operations === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--color-text-muted)]">No data yet</p>
              </div>
            ) : (
              <>
                {/* Counters */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Total ops', value: summary.total_operations },
                    { label: 'Success rate', value: `${summary.success_rate_percent?.toFixed(1) ?? 0}%` },
                    { label: 'Successful', value: summary.success_count },
                    { label: 'Failed', value: summary.failure_count },
                  ].map((s) => (
                    <div key={s.label} className="px-3 py-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)]">
                      <p className="text-[10px] text-[var(--color-text-muted)] mb-0.5">{s.label}</p>
                      <p className="text-sm font-mono font-semibold text-[var(--color-text-primary)]">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Performance */}
                <div>
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Performance</p>
                  <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                    <StatRow label="Avg processing time" value={`${summary.avg_processing_time_sec?.toFixed(2) ?? '-'}s`} />
                    <StatRow label="Avg speed ratio" value={`${summary.avg_speed_ratio?.toFixed(2) ?? '-'}×`} />
                    <StatRow label="Fastest operation" value={`${summary.fastest_operation_sec?.toFixed(2) ?? '-'}s`} />
                    <StatRow label="Slowest operation" value={`${summary.slowest_operation_sec?.toFixed(2) ?? '-'}s`} />
                    <StatRow label="Avg CPU usage" value={`${summary.avg_cpu_percent?.toFixed(1) ?? '-'}%`} />
                    <StatRow label="Peak RAM" value={`${summary.peak_ram_mb?.toFixed(0) ?? '-'} MB`} />
                    <StatRow label="Avg compression" value={`${summary.avg_compression_pct?.toFixed(1) ?? '-'}%`} />
                    <StatRow label="GPU available" value={summary.gpu_available ? 'Yes' : 'No'} mono={false} />
                  </div>
                </div>

                <p className="text-[10px] text-[var(--color-text-muted)] text-center">
                  Data saved to <span className="font-mono">metrics/</span>
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
