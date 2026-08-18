'use client';
import { useEffect, useState } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const catColor: Record<string, { bg: string; fg: string }> = {
  'Pest Control': { bg: '#e6f0ff', fg: '#0052cc' },
  'Rodent Bundle': { bg: '#fef0e6', fg: '#b45309' },
  'Termite': { bg: '#f0e6ff', fg: '#6b21a8' },
  'Mosquito': { bg: '#e6f9ec', fg: '#128a3f' },
  'Mosquito Misting': { bg: '#e6f9ec', fg: '#0f766e' },
  'Bed Bugs': { bg: '#fee2e2', fg: '#b91c1c' },
  'Flea & German Roaches': { bg: '#fef9e6', fg: '#a16207' },
  'Bait Station': { bg: '#f1efe8', fg: '#6b6a64' },
  'Fly Control': { bg: '#f1efe8', fg: '#6b6a64' },
  'Mole/OLT': { bg: '#eef2e6', fg: '#5a7302' },
};
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function CsrPestSalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('All');
  const [tab, setTab] = useState<'sales' | 'byCsr'>('sales');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [saleFrom, setSaleFrom] = useState('');
  const [saleTo, setSaleTo] = useState('');
  const [initFrom, setInitFrom] = useState('');
  const [initTo, setInitTo] = useState('');
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const [selYear, setSelYear] = useState(currentYear);
  const [selMonth, setSelMonth] = useState<number | null>(null); // null = whole year

  useEffect(() => {
    setLoading(true);
    const mParam = selMonth == null ? '' : `&month=${selMonth}`;
    fetch(`/api/csr-pest-sales?office=${office}&year=${selYear}${mParam}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [office, selYear, selMonth]);

  const inRange = (d: string | null, from: string, to: string) => {
    if (!d) return !from && !to;
    const day = new Date(d).toISOString().slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };
  const sales = (data?.sales || []).filter((s: any) => {
    if (search && !(s.customerName || '').toLowerCase().includes(search.toLowerCase()) && !(s.sellerName || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (status === 'Serviced' && !s.initialDone) return false;
    if (status === 'Pending' && s.initialDone) return false;
    if ((saleFrom && saleTo) && !inRange(s.saleDate, saleFrom, saleTo)) return false;
    if ((initFrom && initTo) && !inRange(s.initialCompletedAt, initFrom, initTo)) return false;
    return true;
  });
  const rollup = data?.rollup || [];
  const offices: string[] = data?.offices || [];

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' as const };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8' };
  const tdR = { ...td, textAlign: 'right' as const };

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>CSR Pest Sales</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>Pest, rodent bundle, and termite sales made by CSRs.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, marginTop: 20, borderBottom: '0.5px solid #E8E7E3' }}>
        {([['sales', 'Sales'], ['byCsr', 'By CSR']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontSize: 14, fontWeight: tab === k ? 600 : 400, color: tab === k ? '#2C2C2A' : '#888780',
              background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? '#2C2C2A' : 'transparent'}`,
              padding: '0 0 10px', marginBottom: -0.5, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* Office filter (shared) */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
        <select value={office} onChange={e => setOffice(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All offices</option>
          {['DFW', 'ATX', 'OKC', 'CStat', ...offices.filter(o => !['DFW', 'ATX', 'OKC', 'CStat'].includes(o))].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {tab === 'sales' && <>
          <input type="text" placeholder="Search customer/CSR..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 180 }} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
            <option value="All">All statuses</option><option value="Serviced">Serviced</option><option value="Pending">Pending initial</option>
          </select>
        </>}
      </div>

      {/* Year + Month selector (By CSR rollup only) */}
      {tab === 'byCsr' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(data?.years?.length ? data.years : [currentYear]).map((y: number) => (
              <button key={y} onClick={() => setSelYear(y)}
                style={{ padding: '5px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', cursor: 'pointer', fontWeight: 500,
                  background: selYear === y ? '#0891b2' : '#fff', color: selYear === y ? '#fff' : '#444441' }}>{y}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => setSelMonth(null)}
              style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '0.5px solid #D3D1C7', cursor: 'pointer',
                background: selMonth == null ? '#2C2C2A' : '#fff', color: selMonth == null ? '#fff' : '#888780', fontWeight: selMonth == null ? 600 : 400 }}>Full year</button>
            {MONTHS.map((m, idx) => {
              const isFuture = selYear === currentYear && idx > currentMonth;
              return (
                <button key={m} disabled={isFuture} onClick={() => setSelMonth(idx)}
                  style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '0.5px solid #D3D1C7', cursor: isFuture ? 'default' : 'pointer',
                    background: selMonth === idx ? '#0891b2' : '#fff', color: isFuture ? '#D3D1C7' : selMonth === idx ? '#fff' : '#888780', fontWeight: selMonth === idx ? 600 : 400 }}>{m}</button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888780' }}>Sale date:</span>
            <input type="date" value={saleFrom} onChange={e => setSaleFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
            <span style={{ fontSize: 12, color: '#B4B2A9' }}>to</span>
            <input type="date" value={saleTo} onChange={e => setSaleTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888780' }}>Initial service:</span>
            <input type="date" value={initFrom} onChange={e => setInitFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
            <span style={{ fontSize: 12, color: '#B4B2A9' }}>to</span>
            <input type="date" value={initTo} onChange={e => setInitTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          </div>
          {(saleFrom || saleTo || initFrom || initTo) && (
            <button onClick={() => { setSaleFrom(''); setSaleTo(''); setInitFrom(''); setInitTo(''); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>Clear dates</button>
          )}
        </div>
      )}

      {/* Sales-tab summary — respects the current office/status/date filters */}
      {!loading && tab === 'sales' && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 13, color: '#2C2C2A', flexWrap: 'wrap' }}>
          <span><strong>{sales.length}</strong> sales</span>
          <span><strong>{money(sales.reduce((a: number, s: any) => a + (s.contractValue || 0), 0))}</strong> contract value</span>
          <span style={{ color: '#128a3f' }}><strong>{sales.filter((s: any) => s.initialDone).length}</strong> serviced</span>
          <span style={{ color: '#b45309' }}><strong>{sales.filter((s: any) => !s.initialDone).length}</strong> pending initial</span>
          {((saleFrom && saleTo) || (initFrom && initTo)) && <span style={{ color: '#888780' }}>(filtered)</span>}
        </div>
      )}

      {loading ? <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>Loading…</p> : (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          {tab === 'sales' ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Customer</th><th style={th}>CSR</th><th style={th}>Category</th><th style={th}>Service</th>
                <th style={thR}>Contract Value</th><th style={th}>Sale Date</th><th style={th}>Initial Service Date</th><th style={th}>Status</th>
              </tr></thead>
              <tbody>
                {sales.length === 0 ? (
                  <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={8}>No CSR pest sales for these filters. Run the sync to pull sales.</td></tr>
                ) : sales.map((s: any) => {
                  const c = catColor[s.category] || { bg: '#f1efe8', fg: '#6b6a64' };
                  return (
                    <tr key={s.id}>
                      <td style={td}>{s.customerName || <span style={{ color: '#B4B2A9' }}>Unknown</span>}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{s.sellerName}</td>
                      <td style={td}><span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: c.bg, color: c.fg }}>{s.category}</span></td>
                      <td style={{ ...td, color: '#6b6a64', maxWidth: 240 }}>{s.serviceName || '—'}</td>
                      <td style={tdR}>{money(s.contractValue || 0)}</td>
                      <td style={{ ...td, color: '#6b6a64', whiteSpace: 'nowrap' }}>{fmtDate(s.saleDate)}</td>
                      <td style={{ ...td, color: '#6b6a64', whiteSpace: 'nowrap' }}>{fmtDate(s.initialCompletedAt)}</td>
                      <td style={td}><span style={{ fontSize: 11, fontWeight: 500, color: s.initialDone ? '#128a3f' : '#a16207' }}>{s.initialDone ? 'Serviced' : 'Pending'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>CSR Name</th>
                <th style={thR}># of Subscriptions Sold</th>
                <th style={thR}>Completed</th>
                <th style={thR}>Pending Initial Service</th>
                <th style={thR}>Contract Value</th>
              </tr></thead>
              <tbody>
                {rollup.length === 0 ? (
                  <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={5}>No CSR pest sales yet.</td></tr>
                ) : rollup.map((r: any) => (
                  <tr key={r.csrName}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.csrName}</td>
                    <td style={tdR}>{r.sold}</td>
                    <td style={{ ...tdR, color: '#128a3f' }}>{r.completed}</td>
                    <td style={{ ...tdR, color: '#a16207' }}>{r.pending}</td>
                    <td style={tdR}>{money(r.completedCV || 0)}</td>
                  </tr>
                ))}
                {rollup.length > 0 && (
                  <tr style={{ background: '#faf9f6' }}>
                    <td style={{ ...td, fontWeight: 600 }}>TOTAL</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{rollup.reduce((a: number, r: any) => a + r.sold, 0)}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{rollup.reduce((a: number, r: any) => a + r.completed, 0)}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{rollup.reduce((a: number, r: any) => a + r.pending, 0)}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{money(rollup.reduce((a: number, r: any) => a + (r.completedCV || 0), 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'byCsr' && <p style={{ fontSize: 11, color: '#B4B2A9', marginTop: 10 }}>Contract Value shown is for completed (serviced) subscriptions only, per the report definition.</p>}
    </div>
  );
}
