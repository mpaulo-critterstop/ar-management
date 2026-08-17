'use client';
import { useEffect, useState } from 'react';

const money = (n: number) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const monthLabel = (m: string) => m === 'unknown' ? 'Unknown' : new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const tenure = (days: number | null) => days == null ? '—' : days >= 365 ? `${(days / 365).toFixed(1)} yr` : `${days} d`;

const reasonColor: Record<string, string> = {
  'Moved / Relocated': '#6b7280', 'Price / Cost': '#b45309', 'Dissatisfied / Service Quality': '#b91c1c',
  'No Longer Needed': '#0891b2', 'Going with Competitor': '#7c3aed', 'Deceased / Health': '#6b7280',
  'Non-Payment / Billing': '#a16207', 'Duplicate / Admin': '#9ca3af', 'Renter / Moved Out': '#6b7280',
  'Bundle Cascade': '#9ca3af', 'Contract Expired': '#0f766e', 'Non-Renewal': '#c2410c',
  'DIY / Self-Service': '#7c3aed', 'Other': '#6b6a64', 'No Reason Given': '#b4b2a9',
};

export default function CancellationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('All');
  const [tab, setTab] = useState<'churn' | 'winback'>('churn');
  const [reasonFilter, setReasonFilter] = useState('All');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cancellations?office=${office}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [office]);
  useEffect(() => { setPage(1); }, [reasonFilter, office, tab]);

  const churn = data?.churn;
  const offices: string[] = data?.offices || [];
  const winbackAll = (data?.winback || []).filter((w: any) => reasonFilter === 'All' || w.reasonBucket === reasonFilter);
  const PAGE = 25;
  const winback = winbackAll.slice((page - 1) * PAGE, page * PAGE);
  const totalPages = Math.max(1, Math.ceil(winbackAll.length / PAGE));

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' as const };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8' };
  const tdR = { ...td, textAlign: 'right' as const };

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Pest Cancellations</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>Canceled pest subscriptions from FieldRoutes — churn analysis and a win-back list for re-engagement.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, marginTop: 20, borderBottom: '0.5px solid #E8E7E3' }}>
        {([['churn', 'Churn Report'], ['winback', 'Win-Back List']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontSize: 14, fontWeight: tab === k ? 600 : 400, color: tab === k ? '#2C2C2A' : '#888780',
              background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? '#2C2C2A' : 'transparent'}`,
              padding: '0 0 10px', marginBottom: -0.5, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {/* Office filter */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
        <select value={office} onChange={e => setOffice(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All offices</option>
          {['DFW', 'ATX', 'OKC', 'CStat', ...offices.filter(o => !['DFW', 'ATX', 'OKC', 'CStat'].includes(o))].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {tab === 'winback' && (
          <>
            <span style={{ fontSize: 12, color: '#888780', marginLeft: 8 }}>Reason:</span>
            <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
              <option value="All">All reasons</option>
              {(churn?.byReason || []).map((r: any) => <option key={r.reason} value={r.reason}>{r.reason}</option>)}
            </select>
          </>
        )}
      </div>

      {loading ? <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>Loading…</p> : !churn ? (
        <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>No cancellation data yet. Run the sync first.</p>
      ) : tab === 'churn' ? (
        <>
          {/* Totals */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Cancellations', value: churn.totals.count.toLocaleString() },
              { label: 'Lost Annual Value', value: money(churn.totals.lostARV) },
              { label: 'Lost Contract Value', value: money(churn.totals.lostCV) },
              { label: 'Avg Tenure', value: tenure(churn.totals.avgTenureDays) },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, minWidth: 150, padding: '14px 16px', border: '0.5px solid #E8E7E3', borderRadius: 10, background: '#fff' }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#2C2C2A' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* By reason */}
            <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#2C2C2A', borderBottom: '0.5px solid #E8E7E3' }}>By Reason</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Reason</th><th style={thR}>Count</th><th style={thR}>Lost ARV</th></tr></thead>
                <tbody>
                  {churn.byReason.map((r: any) => (
                    <tr key={r.reason}>
                      <td style={td}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: reasonColor[r.reason] || '#6b6a64', marginRight: 8 }} />{r.reason}</td>
                      <td style={tdR}>{r.count}</td><td style={tdR}>{money(r.lostARV)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By month */}
            <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#2C2C2A', borderBottom: '0.5px solid #E8E7E3' }}>By Month</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Month</th><th style={thR}>Count</th><th style={thR}>Lost ARV</th></tr></thead>
                <tbody>
                  {churn.byMonth.map((m: any) => (
                    <tr key={m.month}><td style={td}>{monthLabel(m.month)}</td><td style={tdR}>{m.count}</td><td style={tdR}>{money(m.lostARV)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By service */}
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff', marginTop: 16 }}>
            <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#2C2C2A', borderBottom: '0.5px solid #E8E7E3' }}>By Service Category</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Category</th><th style={thR}>Count</th><th style={thR}>Lost ARV</th></tr></thead>
              <tbody>
                {churn.byService.map((s: any) => (
                  <tr key={s.service}><td style={td}>{s.service}</td><td style={tdR}>{s.count}</td><td style={tdR}>{money(s.lostARV)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Win-back list */
        <>
          <div style={{ fontSize: 12, color: '#888780', marginBottom: 10 }}>
            {winbackAll.length} winnable {winbackAll.length === 1 ? 'lead' : 'leads'} (excludes Moved & Deceased). Most recent first.
          </div>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Customer</th><th style={th}>Contact</th><th style={th}>Service</th>
                <th style={thR}>Annual Value</th><th style={th}>Tenure</th><th style={th}>Canceled</th><th style={th}>Reason</th>
              </tr></thead>
              <tbody>
                {winback.length === 0 ? (
                  <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={7}>No win-back leads for these filters.</td></tr>
                ) : winback.map((w: any) => (
                  <tr key={w.id}>
                    <td style={{ ...td, fontWeight: 500 }}>{w.customerName || <span style={{ color: '#B4B2A9' }}>Unknown</span>}<div style={{ fontSize: 10, color: '#B4B2A9' }}>{w.office}</div></td>
                    <td style={{ ...td, fontSize: 12, color: '#6b6a64' }}>{w.customerPhone || '—'}{w.customerEmail ? <div style={{ fontSize: 11 }}>{w.customerEmail}</div> : null}</td>
                    <td style={{ ...td, color: '#6b6a64', maxWidth: 200 }}>{w.serviceType || w.category}</td>
                    <td style={tdR}>{money(w.annualRecurringValue)}</td>
                    <td style={td}>{tenure(w.tenureDays)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b6a64' }}>{fmtDate(w.dateCancelled)}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: reasonColor[w.reasonBucket] || '#6b6a64' }}>{w.reasonBucket}</span>
                      {w.reasonRaw ? <div style={{ fontSize: 10, color: '#B4B2A9', maxWidth: 200 }} title={w.reasonRaw}>{w.reasonRaw.length > 40 ? w.reasonRaw.slice(0, 40) + '…' : w.reasonRaw}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {winbackAll.length > PAGE && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#888780' }}>
              <span>Showing {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, winbackAll.length)} of {winbackAll.length}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === 1 ? '#D3D1C7' : '#2C2C2A', cursor: page === 1 ? 'default' : 'pointer' }}>‹ Prev</button>
                <span style={{ padding: '4px 8px' }}>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === totalPages ? '#D3D1C7' : '#2C2C2A', cursor: page === totalPages ? 'default' : 'pointer' }}>Next ›</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
