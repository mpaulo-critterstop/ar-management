'use client';
import { useEffect, useState } from 'react';
import CCDatePicker from '@/components/cc/DatePicker';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, SearchBox as CCSearchBox } from '@/components/cc/Layout';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

export default function PestInspectionsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'byPM' | 'list'>('byPM');
  const [type, setType] = useState('all');       // all | Pest | Termite
  const [office, setOffice] = useState('All');
  const [statusF, setStatusF] = useState('All');  // All | SOLD | INSPECTED
  const [pmF, setPmF] = useState('All');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    // Only (re)fetch when the date range is complete (both set) or empty (neither) — avoids refetching the
    // instant a From date is entered without a To.
    const bothOrNeither = (!!from && !!to) || (!from && !to);
    if (!bothOrNeither) return;
    setLoading(true);
    const qs = new URLSearchParams();
    if (type !== 'all') qs.set('type', type);
    if (office !== 'All') qs.set('office', office);
    if (from && to) { qs.set('from', from); qs.set('to', to); }
    fetch(`/api/pest-inspections?${qs}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [type, office, from, to]);

  const totals = data?.totals;
  const byPM = data?.byPM || [];
  const pmOptions = ['All', ...Array.from(new Set((data?.rows || []).map((r: any) => r.pmName).filter(Boolean))).sort() as string[]];
  const rows = (data?.rows || []).filter((r: any) => {
    if (statusF !== 'All' && r.status !== statusF) return false;
    if (pmF !== 'All' && r.pmName !== pmF) return false;
    if (search.trim() && !(r.customerName || '').toLowerCase().includes(search.toLowerCase()) && !(r.customerId || '').includes(search)) return false;
    return true;
  });

  const overallClose = totals && totals.inspections > 0 ? Math.round((totals.sold / totals.inspections) * 1000) / 10 : null;

  const th: React.CSSProperties = { textAlign: 'left', padding: '11px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: '#908E85', borderBottom: '1px solid #2A2A30', whiteSpace: 'nowrap', background: '#232329' }; const _unused_th: any = { padding: '10px 12px', textAlign: 'left', fontWeight: 500, color: '#908E85', fontSize: 12, borderBottom: '0.5px solid #2A2A30' };
  const thR = { ...th, textAlign: 'right' as const };
  const td: any = { padding: '10px 12px', fontSize: 13, borderBottom: '0.5px solid #232329' };
  const tdR = { ...td, textAlign: 'right' as const };

  const pill = (v: string, cur: string, set: (s: string) => void, label?: string) => (
    <button onClick={() => set(v)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: `1px solid ${cur === v ? '#5B9BE0' : '#2A2A30'}`, background: cur === v ? '#15263a' : '#1C1C21', color: cur === v ? '#5B9BE0' : '#908E85' }}>{label || v}</button>
  );

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="🔎" title="Pest & Termite Inspection Tracker" subtitle="Inspections marked SOLD on a matching pest invoice; close rate = sold ÷ inspections per PM" />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#232329', border: '0.5px solid #2A2A30' }}>
          {pill('all', type, setType, 'Pest + Termite')}{pill('Pest', type, setType)}{pill('Termite', type, setType)}
        </div>
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#232329', border: '0.5px solid #2A2A30' }}>
          {['All', 'DFW', 'ATX', 'OKC', 'CStat'].map(o => pill(o, office, setOffice))}
        </div>
        <CCDatePicker value={from} onChange={setFrom} />
        <span style={{ fontSize: 12, color: '#908E85' }}>–</span>
        <CCDatePicker value={to} onChange={setTo} />
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>Clear</button>}
      </div>

      {totals && (
        <CCKpiStrip items={[
          { icon: '🔎', label: 'Inspections', value: totals.inspections, tone: 'blue' },
          { icon: '✅', label: 'Sold', value: totals.sold, tone: 'green' },
          { icon: '📈', label: 'Close rate', value: overallClose != null ? `${overallClose}%` : '—', tone: 'amber' },
          { icon: '💵', label: 'Sold value', value: money(totals.soldValue), tone: 'green' },
        ]} />
      )}

      {/* Tabs */}
      <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#232329', border: '0.5px solid #2A2A30', marginBottom: 12 }}>
        {pill('byPM', tab, (v) => setTab(v as any), 'By PM')}{pill('list', tab, (v) => setTab(v as any), 'All Inspections')}
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#908E85' }}>Loading…</div> : tab === 'byPM' ? (
        <div style={{ overflowX: 'auto', border: '0.5px solid #2A2A30', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1C1C21' }}>
            <thead>
              <tr>
                <th style={{ ...th, borderBottom: 'none' }}></th>
                <th style={{ ...thR, borderBottom: '0.5px solid #2A2A30', color: '#5B9BE0' }} colSpan={3}>Pest</th>
                <th style={{ ...thR, borderBottom: '0.5px solid #2A2A30', color: '#9D8BE6' }} colSpan={3}>Termite</th>
                <th style={{ ...thR, borderBottom: 'none' }} colSpan={2}>Overall</th>
              </tr>
              <tr>
                <th style={th}>PM</th>
                <th style={thR}>Insp.</th><th style={thR}>Sold</th><th style={thR}>Close %</th>
                <th style={thR}>Insp.</th><th style={thR}>Sold</th><th style={thR}>Close %</th>
                <th style={thR}>Total Close %</th><th style={thR}>Sold Value</th>
              </tr>
            </thead>
            <tbody>
              {byPM.length === 0 ? <tr><td style={{ ...td, textAlign: 'center', padding: 30, color: '#908E85' }} colSpan={9}>No inspections.</td></tr> :
                byPM.map((p: any) => {
                  const rateColor = (r: number | null) => r == null ? '#63615A' : r >= 30 ? '#43B892' : r >= 15 ? '#DBA14E' : '#E57C7C';
                  const rate = (r: number | null) => r != null ? `${r}%` : '—';
                  return (
                  <tr key={p.pm}>
                    <td style={{ ...td, fontWeight: 500 }}>{p.pm}</td>
                    <td style={tdR}>{p.pestInsp}</td>
                    <td style={{ ...tdR, color: p.pestSold > 0 ? '#43B892' : '#908E85' }}>{p.pestSold}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: rateColor(p.pestCloseRate) }}>{rate(p.pestCloseRate)}</td>
                    <td style={tdR}>{p.termiteInsp}</td>
                    <td style={{ ...tdR, color: p.termiteSold > 0 ? '#43B892' : '#908E85' }}>{p.termiteSold}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: rateColor(p.termiteCloseRate) }}>{rate(p.termiteCloseRate)}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: rateColor(p.closeRate) }}>{rate(p.closeRate)}</td>
                    <td style={tdR}>{money(p.soldValue)}</td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
            <div style={{ minWidth: 230 }}><CCSearchBox value={search} onChange={setSearch} placeholder="Search customer / FR ID…" /></div>
            <select value={pmF} onChange={e => setPmF(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8' }}>
              {pmOptions.map((p: string) => <option key={p} value={p}>{p === 'All' ? 'All PMs' : p}</option>)}
            </select>
            <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#232329', border: '0.5px solid #2A2A30' }}>
              {['All', 'SOLD', 'INSPECTED'].map(s => pill(s, statusF, setStatusF))}
            </div>
          </div>
          <div style={{ overflowX: 'auto', border: '0.5px solid #2A2A30', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1C1C21' }}>
              <thead><tr>
                <th style={th}>Customer</th><th style={th}>Type</th><th style={th}>Inspection Date</th>
                <th style={th}>PM</th><th style={th}>Status</th><th style={thR}>Sold Amount</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td style={{ ...td, textAlign: 'center', padding: 30, color: '#908E85' }} colSpan={6}>No inspections.</td></tr> :
                  rows.map((r: any) => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 500 }}>{r.customerName || <span style={{ color: '#63615A' }}>Unknown</span>}<div style={{ fontSize: 10, color: '#63615A' }}>{r.office} · FR {r.customerId}</div></td>
                      <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: r.inspectionType === 'Termite' ? '#f0e6ff' : '#e6f0ff', color: r.inspectionType === 'Termite' ? '#9D8BE6' : '#5B9BE0' }}>{r.inspectionType}</span></td>
                      <td style={{ ...td, color: '#C9C7BF', whiteSpace: 'nowrap' }}>{fmtDate(r.inspectionDate)}</td>
                      <td style={{ ...td, color: r.pmName ? '#F0EEE8' : '#63615A' }}>{r.pmName || 'Unattributed'}</td>
                      <td style={td}><span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: r.status === 'SOLD' ? '#e6f7ed' : '#232329', color: r.status === 'SOLD' ? '#43B892' : '#908E85' }}>{r.status}</span></td>
                      <td style={tdR}>{r.status === 'SOLD' ? money(Number(r.soldContractValue || r.soldAmount || 0)) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
