'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const RANGES = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This week', value: 'this_week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'Last 7 days', value: 'last_7' },
  { label: 'Last 30 days', value: 'last_30' },
  { label: 'This month', value: 'current_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'Custom', value: 'custom' },
];

function fmtDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: any; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8E7E3', borderRadius: 12, padding: '14px 18px', borderLeft: `3px solid ${color || '#0052cc'}` }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a', fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function CallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [range, setRange] = useState('current_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [totalCalls, setTotalCalls] = useState(0);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/dialpad/config').catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setApiKeySet(!!d.config?.dialpad_api_key);
      setTotalCalls(d.totalCalls || 0);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ range });
    if (range === 'custom' && customStart && customEnd) { params.set('start', customStart); params.set('end', customEnd); }
    const res = await fetch(`/api/dialpad/calls?${params}`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [range, customStart, customEnd]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { loadData(); }, [loadData]);

  const saveApiKey = async () => {
    setSavingKey(true); setKeyError('');
    const res = await fetch('/api/dialpad/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'dialpad_api_key', value: newApiKey }),
    });
    const d = await res.json();
    if (d.error) { setKeyError(d.error); setSavingKey(false); return; }
    setApiKeySet(true); setShowSettings(false); setNewApiKey('');
    setSyncing(true); setSyncMsg('Running initial sync...');
    const syncRes = await fetch('/api/dialpad/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPages: 20 }),
    });
    const sd = await syncRes.json();
    setSyncMsg(`Synced ${sd.processed} calls. ${sd.hasMore ? 'More available — sync again.' : 'All caught up!'}`);
    setSyncing(false);
    loadData(); loadConfig();
  };

  const resetSync = async () => {
    if (!confirm('This will delete all synced calls and re-pull everything from Dialpad. Continue?')) return;
    setSyncing(true); setSyncMsg('Clearing existing calls...');
    // Clear the table
    await fetch('/api/dialpad/sync', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    setSyncMsg('Starting fresh sync...');
    await runSync();
  };

  const runSync = async () => {
    setSyncing(true);
    let totalProcessed = 0;
    let hasMore = true;
    let consecutiveErrors = 0;

    while (hasMore && consecutiveErrors < 3) {
      try {
        const res = await fetch('/api/dialpad/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPages: 5 }),
        });
        if (!res.ok) { consecutiveErrors++; await new Promise(r => setTimeout(r, 2000)); continue; }
        const d = await res.json();
        totalProcessed += d.processed || 0;
        hasMore = d.hasMore || false;
        consecutiveErrors = 0;
        setSyncMsg(`Syncing... ${totalProcessed.toLocaleString()} calls pulled${hasMore ? ', continuing...' : ''}`);
        if (!hasMore || d.processed === 0) break;
        await new Promise(r => setTimeout(r, 300));
      } catch {
        consecutiveErrors++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setSyncMsg(`Sync complete — ${totalProcessed.toLocaleString()} calls pulled`);
    setSyncing(false);
    loadData(); loadConfig();
  };

  const runImport = async () => {
    if (!confirm('This will clear all existing call data and reimport from the CSV. Continue?')) return;
    setImporting(true);
    setSyncMsg('Clearing existing data...');

    // Clear
    const clearRes = await fetch('/api/dialpad/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    if (!clearRes.ok) { setSyncMsg('Clear failed'); setImporting(false); return; }

    // Run 77 chunks
    const TOTAL = 77;
    for (let i = 1; i <= TOTAL; i++) {
      setSyncMsg(`Importing... chunk ${i} of ${TOTAL}`);
      try {
        const res = await fetch('/api/dialpad/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'chunk', chunk: i }),
        });
        if (!res.ok) {
          const e = await res.json();
          setSyncMsg(`Error on chunk ${i}: ${e.error}`);
          setImporting(false);
          return;
        }
      } catch (e: any) {
        setSyncMsg(`Network error on chunk ${i}: ${e.message}`);
        setImporting(false);
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    setSyncMsg('Import complete — 38,031 rows loaded!');
    setImporting(false);
    loadData(); loadConfig();
  };

  const role = (session?.user as any)?.role;
  if (status === 'loading') return null;

  const answerRate = data ? Math.round((data.answered / Math.max(data.total, 1)) * 100) : 0;

  // Build daily chart data
  const dailyEntries = data ? Object.entries(data.daily_volume || {}).sort(([a], [b]) => a.localeCompare(b)) : [];

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '8px 10px',
    border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#1a1a1a',
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Calls</h1>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{totalCalls.toLocaleString()} total calls in database</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Range selector */}
          <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: '#F1EFE8', border: '1px solid #E8E7E3' }}>
            {RANGES.map(r => (
              <button key={r.value}
                    onClick={() => { setRange(r.value); setShowCustom(r.value === 'custom'); }}
                style={{
                  padding: '5px 10px', fontSize: 11, fontWeight: 500, borderRadius: 8,
                  color: range === r.value ? '#1a1a1a' : '#666',
                  background: range === r.value ? '#fff' : 'transparent',
                  border: range === r.value ? '1px solid #E8E7E3' : '1px solid transparent',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                {r.label}
              </button>
            ))}
          </div>
          {showCustom && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#1a1a1a' }} />
              <span style={{ fontSize: 12, color: '#888' }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#1a1a1a' }} />
            </div>
          )}
          {role === 'ADMIN' && (
            <>
              <button onClick={runSync} disabled={syncing}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #E8E7E3', background: '#fff', cursor: syncing ? 'default' : 'pointer', color: '#444' }}>
                {syncing ? 'Syncing...' : '↻ Sync'}
              </button>
              <button onClick={runImport} disabled={importing || syncing}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #d1a3ff', background: '#fff', cursor: importing || syncing ? 'default' : 'pointer', color: '#7b2fbe' }}>
                {importing ? syncMsg.includes('chunk') ? syncMsg : '⟳ Importing...' : '⬆ Import CSV'}
              </button>
              <button onClick={resetSync} disabled={syncing}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', cursor: syncing ? 'default' : 'pointer', color: '#dc2626' }}>
                ↺ Reset & Re-sync
              </button>
              <button onClick={() => setShowSettings(!showSettings)}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #E8E7E3', background: '#fff', cursor: 'pointer', color: '#444' }}>
                ⚙ Settings
              </button>
            </>
          )}
        </div>
      </div>

      {syncMsg && (
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12, padding: '8px 12px', background: '#F1EFE8', borderRadius: 8, border: '1px solid #E8E7E3' }}>
          {syncMsg}
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div style={{ background: '#fff', border: '1px solid #E8E7E3', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Dialpad Settings</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Dialpad API Key</label>
              <input type="password" value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
                placeholder={apiKeySet ? '••••••••••••••• (update key)' : 'Paste your Dialpad API key'}
                style={inputStyle} />
              {keyError && <div style={{ fontSize: 11, color: '#c00', marginTop: 4 }}>{keyError}</div>}
            </div>
            <button onClick={saveApiKey} disabled={savingKey || !newApiKey}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: '#0052cc', color: '#fff', cursor: savingKey || !newApiKey ? 'default' : 'pointer' }}>
              {savingKey ? 'Saving...' : 'Save & Sync'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
            Webhook URL: <code style={{ background: '#F1EFE8', padding: '2px 6px', borderRadius: 4 }}>https://hub.critterstop.com/api/dialpad/webhook</code>
          </div>
        </div>
      )}

      {!apiKeySet && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Dialpad not connected</div>
          <div style={{ fontSize: 12, color: '#666' }}>Add your Dialpad API key in Settings to start syncing calls.</div>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total inbound" value={loading ? '…' : (data?.total || 0).toLocaleString()} color="#0052cc" />
        <KpiCard label="Answered" value={loading ? '…' : (data?.answered || 0).toLocaleString()} sub={`${answerRate}% answer rate`} color="#2d9e5f" />
        <KpiCard label="Agent missed" value={loading ? '…' : (data?.agent_missed || 0).toLocaleString()} sub={data ? `${(data.ring_no_answer||0).toLocaleString()} ring no answer · ${(data.voicemail||0).toLocaleString()} voicemail` : 'Rang but not answered'} color="#f5a623" />
        <KpiCard label="Missed opportunity" value={loading ? '…' : (data?.missed_opportunity || 0).toLocaleString()} sub="No agent reached" color="#e24b4a" />
        <KpiCard label="First-time callers" value={loading ? '…' : (data?.first_time || 0).toLocaleString()} sub="New leads" color="#7b2fbe" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Daily volume chart */}
        <div style={{ background: '#fff', border: '1px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Daily call volume</div>
          {loading || dailyEntries.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>{loading ? 'Loading...' : 'No data'}</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
              {dailyEntries.map(([date, vol]: any) => {
                const total = (vol.answered || 0) + (vol.missed || 0);
                const maxVol = Math.max(...dailyEntries.map(([, v]: any) => (v.answered || 0) + (v.missed || 0)));
                const h = maxVol > 0 ? Math.max((total / maxVol) * 100, 4) : 4;
                const answeredH = maxVol > 0 ? (vol.answered / maxVol) * 100 : 0;
                const day = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
                return (
                  <div key={date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={`${day}: ${vol.answered} answered, ${vol.missed} missed`}>
                    <div style={{ width: '100%', height: h + '%', position: 'relative', borderRadius: '3px 3px 0 0', overflow: 'hidden', background: '#fde8e8' }}>
                      <div style={{ position: 'absolute', bottom: 0, width: '100%', height: answeredH + '%', background: '#2d9e5f', borderRadius: '3px 3px 0 0' }} />
                    </div>
                    <div style={{ fontSize: 8, color: '#bbb', textAlign: 'center' }}>{day.split(',')[0]}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#2d9e5f' }} /> Answered
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#fde8e8' }} /> Missed
            </div>
          </div>
        </div>

        {/* Tracking numbers */}
        <div style={{ background: '#fff', border: '1px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Calls per tracking number</div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>Loading...</div>
          ) : Object.keys(data?.tracking_numbers || {}).length === 0 ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>No data</div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 160 }}>
              {Object.entries(data?.tracking_numbers || {}).sort(([, a]: any, [, b]: any) => b - a).map(([num, count]: any) => {
                const ft = data?.first_time_by_tracking?.[num];
                return (
                  <div key={num} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F1EFE8' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{num}</div>
                      {ft && <div style={{ fontSize: 11, color: '#888' }}>{ft.first_time} first-time</div>}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0052cc', fontFamily: 'var(--font-mono)' }}>{count}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Agent performance table */}
      <div style={{ background: '#fff', border: '1px solid #E8E7E3', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 0', fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agent performance</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {['Agent', 'Total', 'Answered', 'Missed', 'First-time', 'Answer rate', 'Avg duration'].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888', padding: '8px 12px', borderBottom: '1px solid #E8E7E3', background: '#F9F8F5', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#bbb', fontSize: 13 }}>Loading...</td></tr>
              ) : !data?.agent_stats?.length ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#bbb', fontSize: 13 }}>No data for this period</td></tr>
              ) : (data.agent_stats as any[]).map((agent: any) => {
                const ar = Math.round((agent.answered / Math.max(agent.total, 1)) * 100);
                const avgDur = agent.answered > 0 ? Math.round(agent.totalDuration / agent.answered) : 0;
                return (
                  <tr key={agent.name}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F9F8F5'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                    <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{agent.name}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{agent.total}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#2d9e5f', fontFamily: 'var(--font-mono)' }}>{agent.answered}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: agent.missed > 0 ? '#e24b4a' : '#bbb', fontFamily: 'var(--font-mono)' }}>{agent.missed}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#7b2fbe', fontFamily: 'var(--font-mono)' }}>{agent.first_time || 0}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 5, background: '#E8E7E3', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${ar}%`, height: '100%', background: ar >= 80 ? '#2d9e5f' : ar >= 60 ? '#f5a623' : '#e24b4a', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{ar}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{fmtDuration(avgDur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
