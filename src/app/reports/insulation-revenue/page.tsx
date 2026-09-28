'use client';
import { useEffect, useState } from 'react';

type Row = { office: string; customer: string; customerID: string; firstDay: string; lastDay: string;
  days: number; techDays: number; uniqueTechs: number; insulationRevenue: number; revenuePerTech: number };

// Build recent period options (client-side): last 12 Mondays, last 6 months.
function recentWeeks(n = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  const day = d.getUTCDay(); const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  for (let i = 0; i < n; i++) {
    const m = new Date(mon); m.setUTCDate(mon.getUTCDate() - 7 * i);
    const key = m.toISOString().slice(0, 10);
    out.push({ key, label: `Wk of ${m.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` });
  }
  return out;
}
function recentMonths(n = 6): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({ key: m.toISOString().slice(0, 10), label: m.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  return out;
}

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InsulationRevenueReport() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [options, setOptions] = useState(recentWeeks());
  const [sel, setSel] = useState(options[0]?.key || '');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { const o = period === 'week' ? recentWeeks() : recentMonths(); setOptions(o); setSel(o[0]?.key || ''); }, [period]);

  useEffect(() => {
    if (!sel) return;
    setLoading(true);
    fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [period, sel]);

  async function refresh() {
    setRefreshing(true);
    await fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&refresh=1`).catch(() => {});
    // poll for completion
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      const d = await fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}`).then(r => r.json()).catch(() => null);
      if (d?.cached || tries > 20) { setData(d); setRefreshing(false); clearInterval(poll); }
    }, 15000);
  }

  const rows: Row[] = data?.rows || [];
  const totals = data?.totals || { jobs: 0, totalRevenue: 0, totalTechDays: 0 };
  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Reports</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Insulation Revenue per Tech</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>FAR + Insulation Top-Off revenue per job ÷ total tech-days (crew summed across all work days). Direct Labor columns are for manual entry.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3 }}>
          {(['week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: period === p ? '#fff' : 'transparent', color: period === p ? '#2C2C2A' : '#888780', fontWeight: period === p ? 600 : 400 }}>{p === 'week' ? 'Weekly' : 'Monthly'}</button>
          ))}
        </div>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#2C2C2A' }}>
          {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={refresh} disabled={refreshing} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '0.5px solid #0052cc', background: '#fff', color: '#0052cc', fontWeight: 500, cursor: refreshing ? 'wait' : 'pointer' }}>{refreshing ? 'Refreshing… (up to ~5 min)' : '↻ Refresh from FR'}</button>
        <a href={`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&csv=1`} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '0.5px solid #128a3f', background: '#fff', color: '#128a3f', fontWeight: 500, textDecoration: 'none' }}>⤓ CSV</a>
      </div>

      {data && !data.cached && !loading && (
        <div style={{ fontSize: 13, color: '#B45309', background: '#FBF3E5', border: '0.5px solid #F0D9A8', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          This period hasn’t been computed yet. Click “Refresh from FR” to pull it (takes a few minutes).
        </div>
      )}

      {/* Totals */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Jobs', value: totals.jobs },
          { label: 'Insulation revenue', value: money(totals.totalRevenue) },
          { label: 'Tech-days', value: totals.totalTechDays },
          { label: 'Blended rev / tech-day', value: totals.totalTechDays ? money(totals.totalRevenue / totals.totalTechDays) : '—' },
        ].map(s => (
          <div key={s.label} style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '10px 16px', minWidth: 120, background: '#fff' }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#2C2C2A' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#888780' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ color: '#888780', fontSize: 14 }}>Loading…</div> : (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', maxHeight: '65vh', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thL}>Customer</th><th style={thL}>Office</th>
              <th style={th}>Days</th><th style={th}>Tech-Days</th><th style={th}>Techs</th>
              <th style={th}>Insulation Rev</th><th style={th}>Rev / Tech</th>
              <th style={{ ...th, borderLeft: '0.5px solid #E8E7E3', color: '#B4B2A9' }}>Direct Labor $</th>
              <th style={{ ...th, color: '#B4B2A9' }}>Direct Labor %</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.customerID}>
                  <td style={tdL}>{r.customer}</td>
                  <td style={tdL}>{r.office}</td>
                  <td style={td}>{r.days}</td>
                  <td style={td}>{r.techDays}</td>
                  <td style={td}>{r.uniqueTechs}</td>
                  <td style={td}>{money(r.insulationRevenue)}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#0052cc' }}>{money(r.revenuePerTech)}</td>
                  <td style={{ ...td, borderLeft: '0.5px solid #E8E7E3', color: '#B4B2A9' }}>—</td>
                  <td style={{ ...td, color: '#B4B2A9' }}>—</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} style={{ ...tdL, color: '#888780', padding: 20 }}>No insulation jobs for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
