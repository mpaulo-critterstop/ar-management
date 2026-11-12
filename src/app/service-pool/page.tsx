'use client';
import CCDatePicker from '@/components/cc/DatePicker';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip } from '@/components/cc/Layout';
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

  const th: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '1px solid #2A2A30', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', background: '#232329', position: 'sticky', top: 0, zIndex: 2 };
  const thR = { ...th, textAlign: 'right' as const };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#F0EEE8', borderBottom: '0.5px solid #232329' };
  const tdR = { ...td, textAlign: 'right' as const };

  const CopyId = ({ label, val }: { label: string; val: string }) => (
    <button title={`Copy ${label} ${val}`} onClick={() => { navigator.clipboard?.writeText(val); setCopiedId(val); setTimeout(() => setCopiedId(c => c === val ? null : c), 1500); }}
      style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: copiedId === val ? '#43B892' : '#C9C7BF', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block', textAlign: 'left' }}>
      {copiedId === val ? '✓ copied' : `${label}: ${val}`}
    </button>
  );

  const Row = ({ i, overdue }: { i: any; overdue?: boolean }) => (
    <tr>
      <td style={{ ...td, fontWeight: 500 }}>{i.customerName || <span style={{ color: '#63615A' }}>Unknown</span>}<div style={{ fontSize: 10, color: '#63615A' }}>{i.office}</div></td>
      <td style={td}>
        <CopyId label="FRID" val={i.customerId} />
      </td>
      <td style={{ ...td, fontSize: 12, color: '#C9C7BF' }}>{i.customerPhone || '—'}</td>
      <td style={{ ...td, color: '#C9C7BF', maxWidth: 220 }}>{i.serviceType || i.category}</td>
      <td style={{ ...td, color: '#C9C7BF' }}>{i.frequencyDays ? `${i.frequencyDays}d` : '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap', color: '#C9C7BF' }}>{fmtDate(i.lastCompleted)}</td>
      <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 500, color: overdue ? '#E57C7C' : '#F0EEE8' }}>{fmtDate(i.dueDate)}</td>
      <td style={{ ...tdR, fontWeight: 500, color: overdue ? '#E57C7C' : '#43B892' }}>{overdue ? `${i.daysOverdue}d overdue` : `in ${-i.daysOverdue}d`}</td>
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
    <div style={{ padding: '30px 34px 70px', maxWidth: 1400, margin: '0 auto' }}>
      <CCPageHeader icon="🪣" title="Pest Control Job Pool" subtitle="Active pest & termite subscriptions due for service with no appointment scheduled yet" />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search customer / phone / FR ID..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', minWidth: 220 }} />
        <span style={{ fontSize: 12, color: '#908E85' }}>Office:</span>
        <select value={office} onChange={e => setOffice(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21' }}>
          <option value="All">All offices</option>
          {['DFW', 'ATX', 'OKC', 'CStat', ...offices.filter(o => !['DFW', 'ATX', 'OKC', 'CStat'].includes(o))].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#908E85', marginLeft: 8 }}>Due between:</span>
        <CCDatePicker value={from} onChange={setFrom} />
        <span style={{ fontSize: 12, color: '#63615A' }}>to</span>
        <CCDatePicker value={to} onChange={setTo} />
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>Clear</button>}
      </div>

      {loading ? <p style={{ color: '#908E85', fontSize: 13, padding: 30, textAlign: 'center' }}>Loading…</p> : !data ? (
        <p style={{ color: '#908E85', fontSize: 13, padding: 30, textAlign: 'center' }}>No data. Run the service-pool sync first.</p>
      ) : (
        <>
          <CCKpiStrip items={[
            { icon: '⚠️', label: 'Overdue', value: data.totals.overdueCount, tone: 'red', delta: money(data.totals.overdueCV), deltaTone: 'red' },
            { icon: '📅', label: from || to ? 'Due in window' : 'Due upcoming', value: data.totals.windowCount, tone: 'blue', delta: money(data.totals.windowCV) },
          ]} />

          {/* Overdue — red, prominent, on top */}
          {overdue.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E57C7C', marginBottom: 8 }}>⚠ Overdue — {overdue.length} not scheduled</div>
              <div style={{ border: '0.5px solid #4a2626', borderRadius: 12, overflow: 'auto', background: '#1C1C21' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <Header />
                  <tbody>{overdue.map((i: any) => <Row key={i.id} i={i} overdue />)}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Due in window / upcoming */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#F0EEE8', marginBottom: 8 }}>Due {from || to ? 'in selected window' : 'upcoming'} — {inWindow.length}</div>
            <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'auto', background: '#1C1C21' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <Header />
                <tbody>
                  {inWindow.length === 0 ? (
                    <tr><td style={{ ...td, textAlign: 'center', color: '#908E85', padding: 30 }} colSpan={9}>{from || to ? 'None due in this window.' : 'None upcoming.'}</td></tr>
                  ) : inWindow.map((i: any) => <Row key={i.id} i={i} />)}
                </tbody>
              </table>
            </div>
          </div>

          {data.lastSync && <p style={{ fontSize: 11, color: '#63615A', marginTop: 12 }}>Last synced {new Date(data.lastSync).toLocaleString()}</p>}
        </>
      )}
    </div>
  );
}
