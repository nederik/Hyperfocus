import { useQuery } from '@tanstack/react-query';
import type { StorageUsage } from '@hyperfocus/shared';
import { api } from '../lib/api';

/** Cloudflare quotas use decimal units (1 GB = 1000 MB). */
const fmt = (bytes: number) => {
  const n = (v: number, d: number) => v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (bytes >= 1e9) return `${n(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${n(bytes / 1e6, 1)} MB`;
  return `${n(Math.max(0, Math.round(bytes / 1e3)), 0)} KB`;
};

export const STORAGE_KEY = ['storage'];

/**
 * Storage: images and audio, and the database. On Cloudflare it shows what is left of the free plan
 * (KV 1 GB, D1 500 MB); on a local or Docker install there is no fixed quota, so it shows what is used.
 * Refreshed every minute and after uploads and saves.
 */
export function StorageMeter({ compact }: { compact?: boolean }) {
  const q = useQuery({
    queryKey: STORAGE_KEY,
    queryFn: () => api.get<StorageUsage>('/api/storage'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  if (!q.data) return <div className="st-storage muted small">Measuring storage…</div>;
  const rows = [
    { label: 'Images & audio', ...q.data.media },
    { label: 'Database', ...q.data.db },
  ];
  const limited = rows.every((r) => r.limit !== null);
  return (
    <div className={`st-storage${compact ? ' compact' : ''}`} title={limited ? 'Storage left on the free plan' : 'Storage used'}>
      {rows.map((r) => {
        if (r.limit === null)
          return (
            <div key={r.label} className="st-storage-row">
              <span className="st-storage-label">{r.label}</span>
              <span className="st-storage-text">{fmt(r.used)} used</span>
            </div>
          );
        const pct = Math.min(100, (r.used / r.limit) * 100);
        return (
          <div key={r.label} className="st-storage-row">
            <span className="st-storage-label">{r.label}</span>
            <span className="st-storage-bar" aria-hidden>
              <span style={{ width: `${Math.max(pct, 0.6)}%` }} className={pct > 85 ? 'warn' : ''} />
            </span>
            <span className="st-storage-text">
              {fmt(r.limit - r.used)} free <span className="muted">/ {fmt(r.limit)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
