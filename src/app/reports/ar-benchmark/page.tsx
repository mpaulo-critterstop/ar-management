'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const d1 = (n: any) => n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`;

export default function ArBenchmarkPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => fetch('/api/cron/ar-benchmark?token=critterstop2026').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function refresh() {
    setRefreshing(true);
    await fetch('/api/cron/ar-benchmark?token=critterstop2026&refresh=1').then(r => r.json()).catch(() => {});
    setRefreshing(false); load();
  }

  const LINES = [
    { key: 'pest', label: 'Pest Control', color: '#185FA5' },
    { key: 'wildlife', label: 'Wildlife', color: '#1D9E75' },
    { key: 'insulation', label: 'Insulation', color: '#BA7517' },
  ];
  const WINDOWS = [{ k: 'd30', label: '30-day' }, { k: 'd60', label: '60-day' }, { k: 'd90', label: '90-day' }];

  const th: React.CSSProperties = { textAlign: 'right', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '10px 14px', fontSize: 14, borderBottom: '0.5px solid #F1EFE8' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Reports</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>AR Benchmark — Payment Timing</h1>
        <button onClick={refresh} disabled={refreshing} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: refreshing ? 'wait' : 'pointer' }}>{refreshing ? 'Computing…' : '↻ Refresh this week'}</button>
      </div>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 6px', lineHeight: 1.6 }}>
        Actual days from invoice to full payment, by service line, at 30/60/90-day trailing windows. Pest invoices are due the service day, so this reflects true collection speed.
      </p>
      {data?.weekLabel && <p style={{ fontSize: 12, color: '#B4B2A9', margin: '0 0 20px' }}>{data.weekLabel} · computed {data.computedAt ? new Date(data.computedAt).toLocaleString() : '—'}</p>}

      {loading ? <div style={{ color: '#888780' }}>Loading…</div> : !data?.data ? (
        <div style={{ color: '#888780', fontSize: 14, padding: 20, background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3' }}>No benchmark computed yet. Click "Refresh this week".</div>
      ) : (<>
        {/* Average (headline) table */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Average days to pay</div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Service Line</th>{WINDOWS.map(w => <th key={w.k} style={th}>{w.label}</th>)}</tr></thead>
            <tbody>
              {LINES.map(l => (
                <tr key={l.key}>
                  <td style={{ ...tdL, fontWeight: 600, color: l.color }}>{l.label}</td>
                  {WINDOWS.map(w => {
                    const s = data.data[w.k]?.[l.key];
                    return <td key={w.k} style={{ ...td, fontWeight: 600 }}>{s?.avg != null ? d1(s.avg) : '—'}<span style={{ fontSize: 11, color: '#B4B2A9', fontWeight: 400 }}> · {(s?.n ?? 0).toLocaleString()} invoices</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Median table */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Median days to pay <span style={{ fontWeight: 400, color: '#888780' }}>(typical customer — less skewed by slow payers)</span></div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Service Line</th>{WINDOWS.map(w => <th key={w.k} style={th}>{w.label}</th>)}</tr></thead>
            <tbody>
              {LINES.map(l => (
                <tr key={l.key}>
                  <td style={{ ...tdL, fontWeight: 600, color: l.color }}>{l.label}</td>
                  {WINDOWS.map(w => { const s = data.data[w.k]?.[l.key]; return <td key={w.k} style={td}>{s?.median != null ? d1(s.median) : '—'}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 12, color: '#888780', lineHeight: 1.6, background: '#FBF9F5', border: '0.5px solid #EDEAE2', borderRadius: 10, padding: '12px 14px' }}>
          <b>Reading this:</b> Shorter windows (30-day) tend to <b>understate</b> payment time — slow-paying invoices from recent weeks haven't fully resolved yet, so only fast-payers are counted. The <b>90-day window is the most reliable</b>, especially for Wildlife and Insulation (bigger tickets, slower to pay). The invoice count next to each number shows how much data it's based on — the more invoices, the more reliable the average. Insulation is based on fewer invoices, so treat it as directional.
        </div>
      </>)}
    </div>
  );
}
