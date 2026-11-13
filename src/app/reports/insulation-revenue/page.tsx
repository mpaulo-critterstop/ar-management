'use client';
import { useEffect, useState } from 'react';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';

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
  const [office, setOffice] = useState('DFW');
  const [options, setOptions] = useState(recentWeeks());
  const [sel, setSel] = useState(options[0]?.key || '');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { const o = period === 'week' ? recentWeeks() : recentMonths(); setOptions(o); setSel(o[0]?.key || ''); }, [period]);

  useEffect(() => {
    if (!sel) return;
    setLoading(true);
    // Guard against races: if period/sel/office changes before this fetch resolves, a stale response could
    // overwrite fresh data (the "shows for a second then goes to zero" flicker). Only apply the LATEST request.
    let cancelled = false;
    const reqKey = `${period}|${sel}|${office}`;
    fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&office=${office}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && `${period}|${sel}|${office}` === reqKey) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, sel, office]);

  async function refresh() {
    setRefreshing(true);
    await fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&office=${office}&refresh=1`).catch(() => {});
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      const d = await fetch(`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&office=${office}`).then(r => r.json()).catch(() => null);
      if (d?.cached || tries > 20) { setData(d); setRefreshing(false); clearInterval(poll); }
    }, 15000);
  }

  const rows: Row[] = data?.rows || [];
  const totals = data?.totals || { jobs: 0, totalRevenue: 0, totalTechDays: 0 };
  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '0.5px solid #2A2A30', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#1C1C21' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 13, color: '#F0EEE8', borderBottom: '0.5px solid #232329', whiteSpace: 'nowrap' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '30px 34px 70px' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ Reports</a>
      <div style={{ marginTop: 6 }}><CCPageHeader icon="🧱" title="Insulation Revenue per Tech" /></div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#232329', borderRadius: 8, padding: 3 }}>
          {['DFW', 'ATX', 'OKC', 'CStat'].map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: office === o ? '#1C1C21' : 'transparent', color: office === o ? '#F0EEE8' : '#908E85', fontWeight: office === o ? 600 : 400 }}>{o}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#232329', borderRadius: 8, padding: 3 }}>
          {(['week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: period === p ? '#1C1C21' : 'transparent', color: period === p ? '#F0EEE8' : '#908E85', fontWeight: period === p ? 600 : 400 }}>{p === 'week' ? 'Weekly' : 'Monthly'}</button>
          ))}
        </div>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#F0EEE8' }}>
          {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={refresh} disabled={refreshing} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '0.5px solid #5B9BE0', background: '#1C1C21', color: '#5B9BE0', fontWeight: 500, cursor: refreshing ? 'wait' : 'pointer' }}>{refreshing ? 'Refreshing… (up to ~5 min)' : '↻ Refresh from FR'}</button>
        <a href={`/api/cron/insulation-revenue?token=critterstop2026&period=${period}&date=${sel}&office=${office}&csv=1`} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '0.5px solid #43B892', background: '#1C1C21', color: '#43B892', fontWeight: 500, textDecoration: 'none' }}>⤓ CSV</a>
      </div>

      {data && !data.cached && !loading && (
        <div style={{ fontSize: 13, color: '#DBA14E', background: '#352a16', border: '0.5px solid #4a3a1e', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
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
          <div key={s.label} style={{ border: '0.5px solid #2A2A30', borderRadius: 10, padding: '10px 16px', minWidth: 120, background: '#1C1C21' }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#F0EEE8' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#908E85' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ color: '#908E85', fontSize: 14 }}>Loading…</div> : (
        <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'auto', maxHeight: '65vh', background: '#1C1C21' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thL}>Customer</th><th style={thL}>Office</th>
              <th style={th}>Days</th><th style={th}>Tech-Days</th><th style={th}>Techs</th>
              <th style={th}>Insulation Rev</th><th style={th}>Rev / Tech</th>
              <th style={{ ...th, borderLeft: '0.5px solid #2A2A30', color: '#63615A' }}>Direct Labor $</th>
              <th style={{ ...th, color: '#63615A' }}>Direct Labor %</th>
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
                  <td style={{ ...td, fontWeight: 600, color: '#5B9BE0' }}>{money(r.revenuePerTech)}</td>
                  <td style={{ ...td, borderLeft: '0.5px solid #2A2A30', color: '#63615A' }}>—</td>
                  <td style={{ ...td, color: '#63615A' }}>—</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} style={{ ...tdL, color: '#908E85', padding: 20 }}>No insulation jobs for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
