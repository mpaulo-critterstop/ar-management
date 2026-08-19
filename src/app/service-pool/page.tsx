'use client';
import { useEffect, useState } from 'react';

const money = (n: number) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

export default function ServicePoolPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ office });
    // Only apply a date window when BOTH ends are set — avoids filtering the instant one date is picked.
    const bothOrNeither = (!!from && !!to) || (!from && !to);
    if (from && to) { qs.set('from', from); qs.set('to', to); }
    if (bothOrNeither) {
      fetch(`/api/service-pool?${qs}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
    } else {
      setLoading(false); // one date picked, waiting for the other — don't refetch yet
    }
  }, [office, from, to]);

  const matchSearch = (i: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (i.customerName || '').toLowerCase().includes(q)
      || (i.customerPhone || '').includes(search)
      || (i.customerId || '').includes(search);
  };
  const overdue = (data?.overdue || []).filter(matchSearch);
  const inWindow = (data?.inWindow || []).filter(matchSearch);
  const offices: string[] = data?.offices || [];

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' as const };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8' };
  const tdR = { ...td, textAlign: 'right' as const };

  const CopyId = ({ label, val }: { label: string; val: string }) => (
    <button title={`Copy ${label} ${val}`} onClick={() => { navigator.clipboard?.writeText(val); setCopiedId(val); setTimeout(() => setCopiedId(c => c === val ? null : c), 1500); }}
      style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: copiedId === val ? '#128a3f' : '#6B6A64', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block', textAlign: 'left' }}>
      {copiedId === val ? '✓ copied' : `${label}: ${val}`}
    </button>
  );

  const Row = ({ i, overdue }: { i: any; overdue?: boolean }) => (
    <tr>
      <td style={{ ...td, fontWeight: 500 }}>{i.customerName || <span style={{ color: '#B4B2A9' }}>Unknown</span>}<div style={{ fontSize: 10, color: '#B4B2A9' }}>{i.office}</div></td>
      <td style={td}>
        <CopyId label="FRID" val={i.customerId} />
      </td>
      <td style={{ ...td, fontSize: 12, color: '#6b6a64' }}>{i.customerPhone || '—'}</td>
      <td style={{ ...td, color: '#6b6a64', maxWidth: 220 }}>{i.serviceType || i.category}</td>
      <td style={{ ...td, color: '#6b6a64' }}>{i.frequencyDays ? `${i.frequencyDays}d` : '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b6a64' }}>{fmtDate(i.lastCompleted)}</td>
      <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 500, color: overdue ? '#b91c1c' : '#2C2C2A' }}>{fmtDate(i.dueDate)}</td>
      <td style={{ ...tdR, fontWeight: 500, color: overdue ? '#b91c1c' : '#128a3f' }}>{overdue ? `${i.daysOverdue}d overdue` : `in ${-i.daysOverdue}d`}</td>
      <td style={tdR}>{money(i.contractValue)}</td>
    </tr>
  );

  const Header = () => (
    <thead><tr>
      <th style={th}>Customer</th><th style={th}>FR ID</th><th style={th}>Phone</th><th style={th}>Service</th><th style={th}>Freq</th>
      <th style={th}>Last Service</th><th style={th}>Due Date</th><th style={thR}>Status</th><th style={thR}>Contract Value</th>
    </tr></thead>
  );

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Pest Control Job Pool</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>Active pest &amp; termite subscriptions due for service (last service + frequency) that have no appointment scheduled yet. Overdue shown first.</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search customer / phone / FR ID..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 220 }} />
        <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
        <select value={office} onChange={e => setOffice(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All offices</option>
          {['DFW', 'ATX', 'OKC', 'CStat', ...offices.filter(o => !['DFW', 'ATX', 'OKC', 'CStat'].includes(o))].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#888780', marginLeft: 8 }}>Due between:</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        <span style={{ fontSize: 12, color: '#B4B2A9' }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>Clear</button>}
      </div>

      {loading ? <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>Loading…</p> : !data ? (
        <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>No data. Run the service-pool sync first.</p>
      ) : (
        <>
          {/* Totals */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160, padding: '14px 16px', border: '0.5px solid #f3c9c9', borderRadius: 10, background: '#fdf5f5' }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#b91c1c' }}>{data.totals.overdueCount}</div>
              <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>Overdue &middot; {money(data.totals.overdueCV)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 160, padding: '14px 16px', border: '0.5px solid #E8E7E3', borderRadius: 10, background: '#fff' }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#2C2C2A' }}>{data.totals.windowCount}</div>
              <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>Due{from || to ? ' in window' : ' upcoming'} &middot; {money(data.totals.windowCV)}</div>
            </div>
          </div>

          {/* Overdue — red, prominent, on top */}
          {overdue.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', marginBottom: 8 }}>⚠ Overdue — {overdue.length} not scheduled</div>
              <div style={{ border: '0.5px solid #f3c9c9', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <Header />
                  <tbody>{overdue.map((i: any) => <Row key={i.id} i={i} overdue />)}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Due in window / upcoming */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Due {from || to ? 'in selected window' : 'upcoming'} — {inWindow.length}</div>
            <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <Header />
                <tbody>
                  {inWindow.length === 0 ? (
                    <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={9}>{from || to ? 'None due in this window.' : 'None upcoming.'}</td></tr>
                  ) : inWindow.map((i: any) => <Row key={i.id} i={i} />)}
                </tbody>
              </table>
            </div>
          </div>

          {data.lastSync && <p style={{ fontSize: 11, color: '#B4B2A9', marginTop: 12 }}>Last synced {new Date(data.lastSync).toLocaleString()}</p>}
        </>
      )}
    </div>
  );
}
