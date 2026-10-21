'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function BadDebtCalendarPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cron/bad-debt-calendar?token=critterstop2026')
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const th: React.CSSProperties = { textAlign: 'center', padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { textAlign: 'center', padding: '9px 12px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' as const };
  const tdR = { ...td, textAlign: 'right' as const };

  const now = new Date();
  const nowMonth = now.toISOString().slice(0, 7);

  return (
    <div style={{ maxWidth: 1050, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Reports</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>🗓️ Bad-Debt Accrual Calendar</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 16px', lineHeight: 1.6 }}>
        When each unpaid overdue invoice <b>would have</b> become bad debt under our collections rules (due date → entry → 15-day countdown → ARM/SCC → post-action window), bucketed by month. This is a projection for the scorecard and the bookkeeper conversation — <b>it does not touch FieldRoutes</b>.
      </p>

      {loading && <div style={{ fontSize: 14, color: '#888780', padding: 20 }}>Computing accrual schedule…</div>}

      {data && !loading && (<>
        {/* Summary */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ border: '0.5px solid #F7C1C1', borderRadius: 10, padding: '12px 16px', background: '#FDF6F6', minWidth: 180 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#b91c1c' }}>{money(data.alreadyShouldHaveAccrued)}</div>
            <div style={{ fontSize: 11, color: '#888780' }}>Should have already accrued (to date)</div>
          </div>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: '#fff', minWidth: 180 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2C2C2A' }}>{money(data.grandTotalOverdue)}</div>
            <div style={{ fontSize: 11, color: '#888780' }}>Total projected bad debt (all overdue)</div>
          </div>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: '#fff', minWidth: 120 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2C2C2A' }}>{(data.calendar || []).length}</div>
            <div style={{ fontSize: 11, color: '#888780' }}>Months spanned</div>
          </div>
        </div>

        {/* The calendar */}
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Monthly accrual schedule</div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff', marginBottom: 24 }}>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>Invoices</th>
                <th style={thR}>Collections</th><th style={thR}>SCC</th><th style={thR}>Total</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {(data.calendar || []).map((m: any) => {
                  const past = m.month <= nowMonth;
                  const open = openMonth === m.month;
                  const invs = (data.rows || []).filter((r: any) => r.badDebtMonth === m.month);
                  return (
                    <>
                      <tr key={m.month} onClick={() => setOpenMonth(open ? null : m.month)} style={{ cursor: 'pointer', background: open ? '#FBFBF9' : (past ? '#FDFaFa' : undefined) }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: past ? '#b91c1c' : '#2C2C2A' }}>{monthLabel(m.month)}{past && <span style={{ fontSize: 10, color: '#b91c1c', marginLeft: 6 }}>● past</span>}</td>
                        <td style={td}>{m.count}</td>
                        <td style={tdR}>{money(m.collections)}</td>
                        <td style={tdR}>{money(m.scc)}</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{money(m.total)}</td>
                        <td style={td}><span style={{ fontSize: 11, color: '#185FA5' }}>{open ? '▲ hide' : '▼ view'}</span></td>
                      </tr>
                      {open && (
                        <tr><td colSpan={6} style={{ padding: 0, background: '#FBFBF9' }}>
                          <div style={{ maxHeight: 300, overflowY: 'auto', padding: '4px 0' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead><tr>
                                <th style={{ ...th, fontSize: 10, background: '#FBFBF9', textAlign: 'left', paddingLeft: 24 }}>Invoice</th><th style={{ ...th, fontSize: 10, background: '#FBFBF9', textAlign: 'left' }}>Customer</th><th style={{ ...th, fontSize: 10, background: '#FBFBF9' }}>Office</th><th style={{ ...th, fontSize: 10, background: '#FBFBF9' }}>Track</th><th style={{ ...thR, fontSize: 10, background: '#FBFBF9' }}>Amount</th><th style={{ ...th, fontSize: 10, background: '#FBFBF9' }}>Due</th><th style={{ ...th, fontSize: 10, background: '#FBFBF9' }}>Would-be bad debt</th>
                              </tr></thead>
                              <tbody>
                                {invs.map((r: any) => (
                                  <tr key={r.invoice}>
                                    <td style={{ ...td, fontSize: 12, textAlign: 'left', paddingLeft: 24 }}>{r.invoice}</td>
                                    <td style={{ ...td, fontSize: 12, textAlign: 'left' }}>{r.customer || '—'}</td>
                                    <td style={{ ...td, fontSize: 12 }}>{r.office}</td>
                                    <td style={{ ...td, fontSize: 12 }}><span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: r.track === 'SCC' ? '#FCEBEB' : '#FBF3E5', color: r.track === 'SCC' ? '#b91c1c' : '#BA7517' }}>{r.track}</span></td>
                                    <td style={{ ...tdR, fontSize: 12 }}>{money(r.amount)}</td>
                                    <td style={{ ...td, fontSize: 12 }}>{fmtDate(r.due)}</td>
                                    <td style={{ ...td, fontSize: 12 }}>{fmtDate(r.wouldBadDebtAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td></tr>
                      )}
                    </>
                  );
                })}
                {!(data.calendar || []).length && <tr><td colSpan={6} style={{ ...td, color: '#888780', padding: 20 }}>No overdue invoices to project.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#B4B2A9', lineHeight: 1.6 }}>
          Projection uses the approved rules on the fastest path (no customer-engagement extensions). "Past" months (red) are periods where the bad debt should already have been recognized. Confirm with the bookkeeper before recording anything in FieldRoutes — this view is for the scorecard baseline and the backdating discussion only.
        </p>
      </>)}
    </div>
  );
}
