'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const d1 = (n: any) => n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`;

export default function ArBenchmarkPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weeks, setWeeks] = useState<any[]>([]);
  const [selWeek, setSelWeek] = useState('');

  const load = (week?: string) => {
    setLoading(true);
    const q = week ? `&week=${week}` : '';
    return fetch(`/api/cron/ar-benchmark?token=critterstop2026${q}`).then(r => r.json()).then(d => { setData(d); if (!week && d.weekKey) setSelWeek(d.weekKey); setLoading(false); }).catch(() => setLoading(false));
  };
  const loadWeeks = () => fetch('/api/cron/ar-benchmark?token=critterstop2026&weeks=1').then(r => r.json()).then(d => setWeeks(d.weeks || [])).catch(() => {});
  useEffect(() => { load(); loadWeeks(); }, []);

  function pickWeek(w: string) { setSelWeek(w); load(w); }

  async function refresh() {
    setRefreshing(true);
    await fetch('/api/cron/ar-benchmark?token=critterstop2026&refresh=1').then(r => r.json()).catch(() => {});
    setRefreshing(false); await loadWeeks(); load();
  }

  // Each line uses its own trailing window (matched to the revenue window in the benchmark formula).
  const LINES = [
    { key: 'pest', label: 'Pest Control', color: '#185FA5', win: 'd30', winLabel: '4 weeks' },
    { key: 'wildlife', label: 'Wildlife', color: '#1D9E75', win: 'd60', winLabel: '8 weeks' },
    { key: 'insulation', label: 'Insulation', color: '#BA7517', win: 'd90', winLabel: '13 weeks' },
  ];

  const th: React.CSSProperties = { textAlign: 'center', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'center', padding: '10px 14px', fontSize: 14, borderBottom: '0.5px solid #F1EFE8' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Reports</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>AR Benchmark — Payment Timing</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selWeek} onChange={e => pickWeek(e.target.value)} style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', minWidth: 230 }}>
            {!weeks.length && <option value="">Latest</option>}
            {weeks.map(w => <option key={w.weekKey} value={w.weekKey}>{w.weekLabel}</option>)}
          </select>
          <button onClick={refresh} disabled={refreshing} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: refreshing ? 'wait' : 'pointer' }}>{refreshing ? 'Computing…' : '↻ Refresh this week'}</button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 6px', lineHeight: 1.6 }}>
        Actual days from invoice to full payment, by service line, at 30/60/90-day trailing windows. Pest invoices are due the service day, so this reflects true collection speed.
      </p>
      {data?.weekLabel && <p style={{ fontSize: 12, color: '#B4B2A9', margin: '0 0 20px' }}>{data.weekLabel} · computed {data.computedAt ? new Date(data.computedAt).toLocaleString() : '—'}</p>}

      {loading ? <div style={{ color: '#888780' }}>Loading…</div> : !data?.data ? (
        <div style={{ color: '#888780', fontSize: 14, padding: 20, background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3' }}>No benchmark computed yet. Click "Refresh this week".</div>
      ) : (<>
        {/* Payment timing — one row per line, using each line's own trailing window */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Days to pay <span style={{ fontWeight: 400, color: '#888780' }}>— each line over its own trailing window</span></div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '28%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /></colgroup>
            <thead><tr><th style={thL}>Service Line</th><th style={th}>Window</th><th style={th}>Average</th><th style={th}>Median</th><th style={th}>Invoices</th></tr></thead>
            <tbody>
              {LINES.map(l => {
                const s = data.data[l.win]?.[l.key];
                return (
                  <tr key={l.key}>
                    <td style={{ ...tdL, fontWeight: 600, color: l.color }}>{l.label}</td>
                    <td style={{ ...td, color: '#888780', fontSize: 12 }}>{l.winLabel}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{s?.avg != null ? d1(s.avg) : '—'}</td>
                    <td style={td}>{s?.median != null ? d1(s.median) : '—'}</td>
                    <td style={{ ...td, color: '#888780', fontSize: 12 }}>{(s?.n ?? 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data.data.benchmark && (() => {
          const b = data.data.benchmark; const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
          const rows = [
            { k: 'pest', label: 'Pest Control' }, { k: 'wildlife', label: 'Wildlife' },
            { k: 'insulation', label: 'Insulation' }, { k: 'badDebt', label: 'Bad Debt (1%)' },
          ];
          const actualAR = data.data.actualAR;
          return (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#2C2C2A', margin: '8px 0' }}>AR Benchmark — Expected AR</div>
              <div style={{ fontSize: 12, color: '#888780', marginBottom: 12, lineHeight: 1.6 }}>What AR <i>should</i> be, using Chisam's formula. <b>Actuals</b> uses real payment timing from the Hub; <b>Chisam's</b> uses the theoretical values in the current scorecard formula.</div>
              <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: '34%' }} /><col style={{ width: '33%' }} /><col style={{ width: '33%' }} /></colgroup>
                  <thead><tr><th style={thL}>Component</th><th style={th}>Actuals-based</th><th style={th}>Chisam's (theoretical)</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.k}>
                        <td style={tdL}>{r.label}</td>
                        <td style={td}>{money(b.actual[r.k])}</td>
                        <td style={td}>{money(b.chisam[r.k])}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1.5px solid #E8E7E3' }}>
                      <td style={{ ...tdL, fontWeight: 700 }}>Expected AR (total)</td>
                      <td style={{ ...td, fontWeight: 700, color: '#185FA5' }}>{money(b.actual.total)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(b.chisam.total)}</td>
                    </tr>
                    {actualAR != null && (
                      <tr style={{ background: '#FBF9F5' }}>
                        <td style={{ ...tdL, fontWeight: 600 }}>Actual AR (now)</td>
                        <td style={{ ...td, fontWeight: 600 }} colSpan={2}>{money(actualAR)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 8, lineHeight: 1.6 }}>
                Actuals uses payment timing of ~{b.inputs.actPestPay}d pest (4wk trailing), ~{b.inputs.actWildPay}d wildlife (8wk), ~{b.inputs.actInsPay}d insulation (13wk) — each matched to its revenue window. Operational timelines ({b.inputs.wildOps}d wildlife, {b.inputs.insOps}d insulation), {Math.round(b.inputs.financedPct * 100)}% financed, {Math.round(b.inputs.depositSplit * 100)}% deposit, {Math.round(b.inputs.badDebtPct * 100)}% bad debt carried from Chisam's formula.
              </div>
            </div>
          );
        })()}

        <div style={{ fontSize: 12, color: '#888780', lineHeight: 1.6, background: '#FBF9F5', border: '0.5px solid #EDEAE2', borderRadius: 10, padding: '12px 14px' }}>
          <b>Reading this:</b> Each line's payment timing uses its own trailing window — matched to the revenue window in the benchmark formula (Pest 4wk, Wildlife 8wk, Insulation 13wk). Average is what the benchmark uses; median shows the typical customer (less skewed by slow payers). The invoice count shows how much data each figure is based on — Insulation has the fewest, so treat it as directional. Note: shorter windows can slightly understate timing, since very recent slow-payers haven't fully resolved yet.
        </div>
      </>)}
    </div>
  );
}
