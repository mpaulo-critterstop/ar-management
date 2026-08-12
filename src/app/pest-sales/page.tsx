'use client';
import { useEffect, useState } from 'react';

const OFFICES = ['DFW', 'ATX', 'OKC', 'CStat'];
const CATEGORIES = ['All', 'Pest Control', 'Rodent Bundle', 'Termite'];

const catColor: Record<string, { bg: string; fg: string }> = {
  'Pest Control': { bg: '#e6f0ff', fg: '#0052cc' },
  'Rodent Bundle': { bg: '#fef0e6', fg: '#b45309' },
  'Termite': { bg: '#f0e6ff', fg: '#6b21a8' },
};
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function PestSalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('DFW');
  const [pm, setPm] = useState('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');            // All | Serviced | Pending
  const [saleFrom, setSaleFrom] = useState('');
  const [saleTo, setSaleTo] = useState('');
  const [initFrom, setInitFrom] = useState('');
  const [initTo, setInitTo] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pest-sales?office=${office}&pm=${encodeURIComponent(pm)}&category=${encodeURIComponent(category)}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [office, pm, category]);

  const inRange = (d: string | null, from: string, to: string) => {
    if (!d) return !from && !to ? true : false;   // no date: only passes when no range set
    const day = new Date(d).toISOString().slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };
  const sales = (data?.sales || []).filter((s: any) => {
    if (search && !s.customerName?.toLowerCase().includes(search.toLowerCase())) return false;
    if (status === 'Serviced' && !s.initialDone) return false;
    if (status === 'Pending' && s.initialDone) return false;
    if ((saleFrom || saleTo) && !inRange(s.saleDate, saleFrom, saleTo)) return false;
    if ((initFrom || initTo) && !inRange(s.initialCompletedAt, initFrom, initTo)) return false;
    return true;
  });
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8' };

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Pest Control Sales</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>PM pest, rodent bundle, and termite sales from FieldRoutes. Commission counts once the initial service is completed.</p>
      </div>

      {/* Office toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', paddingTop: 20 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {OFFICES.map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: office === o ? '#2C2C2A' : '#888780', background: office === o ? '#fff' : 'transparent', border: office === o ? '0.5px solid #D3D1C7' : '0.5px solid transparent', cursor: 'pointer' }}>{o}</button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
        <input type="text" placeholder="Search customer..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 180 }} />
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={pm} onChange={e => setPm(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All PMs</option>
          {(data?.pmNames || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All statuses</option>
          <option value="Serviced">Serviced</option>
          <option value="Pending">Pending initial</option>
        </select>
      </div>

      {/* Date-range filters */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Sale date:</span>
          <input type="date" value={saleFrom} onChange={e => setSaleFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          <span style={{ fontSize: 12, color: '#B4B2A9' }}>to</span>
          <input type="date" value={saleTo} onChange={e => setSaleTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Initial service date:</span>
          <input type="date" value={initFrom} onChange={e => setInitFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          <span style={{ fontSize: 12, color: '#B4B2A9' }}>to</span>
          <input type="date" value={initTo} onChange={e => setInitTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        </div>
        {(saleFrom || saleTo || initFrom || initTo) && (
          <button onClick={() => { setSaleFrom(''); setSaleTo(''); setInitFrom(''); setInitTo(''); }}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>Clear dates</button>
        )}
      </div>

      {/* Summary */}
      {data?.totals && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 13, color: '#2C2C2A' }}>
          <span><strong>{data.totals.count}</strong> sales</span>
          <span><strong>{money(data.totals.contractValue)}</strong> contract value</span>
          <span style={{ color: '#128a3f' }}><strong>{data.totals.done}</strong> serviced</span>
          <span style={{ color: '#b45309' }}><strong>{data.totals.pending}</strong> pending initial</span>
        </div>
      )}

      {/* Table */}
      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Customer</th><th style={th}>PM</th><th style={th}>Category</th>
            <th style={th}>Service</th><th style={{ ...th, textAlign: 'right' }}>Contract Value</th>
            <th style={th}>Sale Date</th><th style={th}>Initial Service Date</th><th style={th}>Status</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={8}>Loading…</td></tr>
            ) : sales.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={8}>No pest sales for these filters.</td></tr>
            ) : sales.map((s: any) => {
              const c = catColor[s.category] || { bg: '#f1efe8', fg: '#888780' };
              return (
                <tr key={s.id}>
                  <td style={td}>{s.customerName || <span style={{ color: '#B4B2A9' }}>#{s.customerId}</span>}</td>
                  <td style={td}>{s.pmName}</td>
                  <td style={td}><span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: c.bg, color: c.fg }}>{s.category}</span></td>
                  <td style={{ ...td, color: '#6B6A64' }}>{s.category === 'Rodent Bundle' ? (s.chargeChildService ? `Bundle · ${s.chargeChildService}` : 'Bundle') : s.serviceName}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(s.contractValue)}</td>
                  <td style={{ ...td, color: '#6B6A64' }}>{fmtDate(s.saleDate)}</td>
                  <td style={{ ...td, color: '#6B6A64', fontVariantNumeric: 'tabular-nums' }}>{s.initialDone ? fmtDate(s.initialCompletedAt) : '—'}</td>
                  <td style={td}>
                    {s.initialDone
                      ? <span style={{ fontSize: 12, color: '#128a3f' }}>Serviced</span>
                      : <span style={{ fontSize: 12, color: '#b45309' }}>Pending initial</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
