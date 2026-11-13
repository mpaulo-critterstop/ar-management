'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';

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

  const th: React.CSSProperties = { textAlign: 'center', padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '0.5px solid #2A2A30', whiteSpace: 'nowrap', background: '#1C1C21', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { textAlign: 'center', padding: '9px 12px', fontSize: 13, borderBottom: '0.5px solid #232329', whiteSpace: 'nowrap' };
  const thR = { ...th, textAlign: 'right' as const };
  const tdR = { ...td, textAlign: 'right' as const };

  const now = new Date();
  const nowMonth = now.toISOString().slice(0, 7);

  return (
    <div style={{ maxWidth: 1050, margin: '0 auto', padding: '30px 34px 70px' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ Reports</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ marginTop: 6 }}><CCPageHeader icon="🗓️" title="Bad-Debt Accrual Calendar" /></div>
        <a href="/api/cron/bad-debt-calendar?token=critterstop2026&format=xlsx" style={{ marginTop: 10, fontSize: 13, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#43B892', color: '#fff', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>⬇ Download Excel</a>
      </div>
      <p style={{ fontSize: 13, color: '#908E85', margin: '0 0 16px', lineHeight: 1.6 }}>
        When each unpaid overdue invoice <b>would have</b> become bad debt under our collections rules (due date → entry → 15-day countdown → ARM/SCC → post-action window), bucketed by month. This is a projection for the scorecard and the bookkeeper conversation — <b>it does not touch FieldRoutes</b>.
      </p>

      {loading && <div style={{ fontSize: 14, color: '#908E85', padding: 20 }}>Computing accrual schedule…</div>}

      {data && !loading && (<>
        {/* Summary */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ border: '0.5px solid #4a2626', borderRadius: 10, padding: '12px 16px', background: '#361e1e', minWidth: 180 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#E57C7C' }}>{money(data.alreadyShouldHaveAccrued)}</div>
            <div style={{ fontSize: 11, color: '#908E85' }}>Should have already accrued (to date)</div>
          </div>
          <div style={{ border: '0.5px solid #2A2A30', borderRadius: 10, padding: '12px 16px', background: '#1C1C21', minWidth: 180 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EEE8' }}>{money(data.grandTotalOverdue)}</div>
            <div style={{ fontSize: 11, color: '#908E85' }}>Total projected bad debt (all overdue)</div>
          </div>
          <div style={{ border: '0.5px solid #2A2A30', borderRadius: 10, padding: '12px 16px', background: '#1C1C21', minWidth: 120 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#F0EEE8' }}>{(data.calendar || []).length}</div>
            <div style={{ fontSize: 11, color: '#908E85' }}>Months spanned</div>
          </div>
        </div>

        {/* The calendar */}
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Monthly accrual schedule</div>
        <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'hidden', background: '#1C1C21', marginBottom: 24 }}>
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
                      <tr key={m.month} onClick={() => setOpenMonth(open ? null : m.month)} style={{ cursor: 'pointer', background: open ? '#232329' : (past ? '#232329' : undefined) }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: past ? '#E57C7C' : '#F0EEE8' }}>{monthLabel(m.month)}{past && <span style={{ fontSize: 10, color: '#E57C7C', marginLeft: 6 }}>● past</span>}</td>
                        <td style={td}>{m.count}</td>
                        <td style={tdR}>{money(m.collections)}</td>
                        <td style={tdR}>{money(m.scc)}</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{money(m.total)}</td>
                        <td style={td}><span style={{ fontSize: 11, color: '#5B9BE0' }}>{open ? '▲ hide' : '▼ view'}</span></td>
                      </tr>
                      {open && (
                        <tr><td colSpan={6} style={{ padding: 0, background: '#232329' }}>
                          <div style={{ maxHeight: 300, overflowY: 'auto', padding: '4px 0' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead><tr>
                                <th style={{ ...th, fontSize: 10, background: '#232329', textAlign: 'left', paddingLeft: 24 }}>Invoice</th><th style={{ ...th, fontSize: 10, background: '#232329', textAlign: 'left' }}>Customer</th><th style={{ ...th, fontSize: 10, background: '#232329' }}>Office</th><th style={{ ...th, fontSize: 10, background: '#232329' }}>Track</th><th style={{ ...thR, fontSize: 10, background: '#232329' }}>Amount</th><th style={{ ...th, fontSize: 10, background: '#232329' }}>Due</th><th style={{ ...th, fontSize: 10, background: '#232329' }}>Would-be bad debt</th>
                              </tr></thead>
                              <tbody>
                                {invs.map((r: any) => (
                                  <tr key={r.invoice}>
                                    <td style={{ ...td, fontSize: 12, textAlign: 'left', paddingLeft: 24 }}>{r.invoice}</td>
                                    <td style={{ ...td, fontSize: 12, textAlign: 'left' }}>{r.customer || '—'}</td>
                                    <td style={{ ...td, fontSize: 12 }}>{r.office}</td>
                                    <td style={{ ...td, fontSize: 12 }}><span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, background: r.track === 'SCC' ? '#361e1e' : '#352a16', color: r.track === 'SCC' ? '#E57C7C' : '#DBA14E' }}>{r.track}</span></td>
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
                {!(data.calendar || []).length && <tr><td colSpan={6} style={{ ...td, color: '#908E85', padding: 20 }}>No overdue invoices to project.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#63615A', lineHeight: 1.6 }}>
          Projection uses the approved rules on the fastest path (no customer-engagement extensions). "Past" months (red) are periods where the bad debt should already have been recognized. Confirm with the bookkeeper before recording anything in FieldRoutes — this view is for the scorecard baseline and the backdating discussion only.
        </p>
      </>)}
    </div>
  );
}
