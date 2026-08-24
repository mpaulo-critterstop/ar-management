'use client';
import { useEffect, useState } from 'react';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

export default function PestInspectionsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'byPM' | 'list'>('byPM');
  const [type, setType] = useState('all');       // all | Pest | Termite
  const [office, setOffice] = useState('All');
  const [statusF, setStatusF] = useState('All');  // All | SOLD | INSPECTED
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (type !== 'all') qs.set('type', type);
    if (office !== 'All') qs.set('office', office);
    if (from && to) { qs.set('from', from); qs.set('to', to); }
    fetch(`/api/pest-inspections?${qs}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [type, office, from, to]);

  const totals = data?.totals;
  const byPM = data?.byPM || [];
  const rows = (data?.rows || []).filter((r: any) => {
    if (statusF !== 'All' && r.status !== statusF) return false;
    if (search.trim() && !(r.customerName || '').toLowerCase().includes(search.toLowerCase()) && !(r.customerId || '').includes(search)) return false;
    return true;
  });

  const overallClose = totals && totals.inspections > 0 ? Math.round((totals.sold / totals.inspections) * 1000) / 10 : null;

  const th: any = { padding: '10px 12px', textAlign: 'left', fontWeight: 500, color: '#888780', fontSize: 12, borderBottom: '0.5px solid #E8E7E3' };
  const thR = { ...th, textAlign: 'right' as const };
  const td: any = { padding: '10px 12px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8' };
  const tdR = { ...td, textAlign: 'right' as const };

  const pill = (v: string, cur: string, set: (s: string) => void, label?: string) => (
    <button onClick={() => set(v)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: cur === v ? '0.5px solid #D3D1C7' : '0.5px solid transparent', background: cur === v ? '#fff' : 'transparent', color: cur === v ? '#2C2C2A' : '#888780' }}>{label || v}</button>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Pest &amp; Termite Inspection Tracker</h1>
        <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
      </div>
      <p style={{ fontSize: 13, color: '#888780', marginTop: 4, marginBottom: 16 }}>
        Each pest/termite inspection, marked SOLD when the customer has a matching pest invoice on/after the inspection date. Close rate = sold ÷ inspections per PM.
      </p>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {pill('all', type, setType, 'Pest + Termite')}{pill('Pest', type, setType)}{pill('Termite', type, setType)}
        </div>
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {['All', 'DFW', 'ATX', 'OKC', 'CStat'].map(o => pill(o, office, setOffice))}
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        <span style={{ fontSize: 12, color: '#888780' }}>–</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>Clear</button>}
      </div>

      {/* Summary */}
      {totals && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, padding: '14px 18px', background: '#F8F7F4', borderRadius: 12, border: '0.5px solid #E8E7E3' }}>
          <div><div style={{ fontSize: 22, fontWeight: 600, color: '#2C2C2A' }}>{totals.inspections}</div><div style={{ fontSize: 11, color: '#888780' }}>Inspections</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600, color: '#128a3f' }}>{totals.sold}</div><div style={{ fontSize: 11, color: '#888780' }}>Sold</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600, color: '#0052cc' }}>{overallClose != null ? `${overallClose}%` : '—'}</div><div style={{ fontSize: 11, color: '#888780' }}>Close rate</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600, color: '#2C2C2A' }}>{money(totals.soldValue)}</div><div style={{ fontSize: 11, color: '#888780' }}>Sold value</div></div>
          {totals.unattributed > 0 && <div><div style={{ fontSize: 22, fontWeight: 600, color: '#B4B2A9' }}>{totals.unattributed}</div><div style={{ fontSize: 11, color: '#888780' }}>Unattributed</div></div>}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#F1EFE8', border: '0.5px solid #E8E7E3', marginBottom: 12 }}>
        {pill('byPM', tab, (v) => setTab(v as any), 'By PM')}{pill('list', tab, (v) => setTab(v as any), 'All Inspections')}
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888780' }}>Loading…</div> : tab === 'byPM' ? (
        <div style={{ overflowX: 'auto', border: '0.5px solid #E8E7E3', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={th}>PM</th>
              <th style={thR}>Pest Insp.</th><th style={thR}>Termite Insp.</th><th style={thR}>Total Insp.</th>
              <th style={thR}>Sold</th><th style={thR}>Close Rate</th><th style={thR}>Sold Value</th>
            </tr></thead>
            <tbody>
              {byPM.length === 0 ? <tr><td style={{ ...td, textAlign: 'center', padding: 30, color: '#888780' }} colSpan={7}>No inspections.</td></tr> :
                byPM.map((p: any) => (
                  <tr key={p.pm}>
                    <td style={{ ...td, fontWeight: 500 }}>{p.pm}</td>
                    <td style={tdR}>{p.pestInsp}</td>
                    <td style={tdR}>{p.termiteInsp}</td>
                    <td style={{ ...tdR, fontWeight: 500 }}>{p.totalInsp}</td>
                    <td style={{ ...tdR, color: '#128a3f', fontWeight: 500 }}>{p.totalSold}</td>
                    <td style={{ ...tdR, fontWeight: 600, color: p.closeRate >= 30 ? '#128a3f' : p.closeRate >= 15 ? '#b45309' : '#b91c1c' }}>{p.closeRate != null ? `${p.closeRate}%` : '—'}</td>
                    <td style={tdR}>{money(p.soldValue)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
            <input type="text" placeholder="Search customer / FR ID…" value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 220 }} />
            <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 10, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
              {['All', 'SOLD', 'INSPECTED'].map(s => pill(s, statusF, setStatusF))}
            </div>
          </div>
          <div style={{ overflowX: 'auto', border: '0.5px solid #E8E7E3', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
              <thead><tr>
                <th style={th}>Customer</th><th style={th}>Type</th><th style={th}>Inspection Date</th>
                <th style={th}>PM</th><th style={th}>Status</th><th style={thR}>Sold Amount</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td style={{ ...td, textAlign: 'center', padding: 30, color: '#888780' }} colSpan={6}>No inspections.</td></tr> :
                  rows.map((r: any) => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 500 }}>{r.customerName || <span style={{ color: '#B4B2A9' }}>Unknown</span>}<div style={{ fontSize: 10, color: '#B4B2A9' }}>{r.office} · FR {r.customerId}</div></td>
                      <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: r.inspectionType === 'Termite' ? '#f0e6ff' : '#e6f0ff', color: r.inspectionType === 'Termite' ? '#6b21a8' : '#0052cc' }}>{r.inspectionType}</span></td>
                      <td style={{ ...td, color: '#6b6a64', whiteSpace: 'nowrap' }}>{fmtDate(r.inspectionDate)}</td>
                      <td style={{ ...td, color: r.pmName ? '#2C2C2A' : '#B4B2A9' }}>{r.pmName || 'Unattributed'}</td>
                      <td style={td}><span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: r.status === 'SOLD' ? '#e6f7ed' : '#F1EFE8', color: r.status === 'SOLD' ? '#128a3f' : '#888780' }}>{r.status}</span></td>
                      <td style={tdR}>{r.status === 'SOLD' ? money(Number(r.soldAmount || 0)) : '—'}</td>
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
