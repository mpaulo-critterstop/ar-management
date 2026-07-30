'use client';
import { useState, useEffect, useCallback } from 'react';

// Small "Last synced X min ago ⟳" indicator. The refresh icon triggers the full cron pipeline
// (AR -> Leads -> CSR -> Dispatch) for the given office, matching what the schedulized crons do.
// office = '' or 'ALL' runs all offices.
export function LastSynced({ office }: { office?: string }) {
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const officeParam = office && office !== 'ALL' ? office : '';

  const relTime = (iso: string | null) => {
    if (!iso) return null;
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
    return `${Math.floor(secs / 86400)} d ago`;
  };

  const load = useCallback(() => {
    const key = officeParam || 'DFW'; // when ALL, show DFW's as a representative recent time
    fetch(`/api/sync/last-run?office=${officeParam || key}`)
      .then(r => r.json())
      .then(d => {
        const rec = d?.[officeParam || key];
        setLastRun(rec?.completedAt ?? null);
        setStatus(rec?.status ?? null);
      })
      .catch(() => {});
  }, [officeParam]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [load]);

  const triggerSync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/cron/sync?token=critterstop2026${officeParam ? `&office=${officeParam}` : ''}`);
    } catch {}
    // Pipeline runs in background; poll a few times so the timestamp updates when it lands.
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      load();
      if (tries >= 12) { clearInterval(poll); setBusy(false); }
    }, 15000);
    setTimeout(() => setBusy(false), 8000); // stop the spinner after a bit regardless
  };

  const rel = relTime(lastRun);

  return (
    <span style={{ fontSize: 11, fontStyle: 'italic', color: status === 'error' ? '#A3612D' : '#A8A69E', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {rel ? `Last synced ${rel}${status === 'error' ? ' (last run had errors)' : ''}` : 'Not synced yet'}
      <button
        onClick={triggerSync}
        disabled={busy}
        title="Sync now"
        style={{ border: 'none', background: 'none', cursor: busy ? 'default' : 'pointer', color: '#888780', fontSize: 13, padding: 0, lineHeight: 1, display: 'inline-flex' }}
      >
        <span style={{ display: 'inline-block', animation: busy ? 'spin 0.8s linear infinite' : 'none' }}>⟳</span>
      </button>
    </span>
  );
}
