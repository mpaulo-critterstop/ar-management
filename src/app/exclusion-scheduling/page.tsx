'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';
import { Btn as CCBtn } from '@/components/cc/Primitives';

const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function ExclusionScheduling() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/exclusion-scheduling?token=critterstop2026')
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const refreshBookings = async () => {
    setChecking(true);
    try { await fetch('/api/exclusion-scheduling/check?token=critterstop2026'); } catch {}
    setChecking(false);
    load();
  };

  const statusStyle = (note: string): React.CSSProperties => {
    const n = (note || '').toLowerCase();
    // Pending = neutral "waiting" state (slate/blue) — kept clearly distinct from the amber under-allotted.
    if (n.includes('pending')) return { background: '#EDF1F7', color: '#5B9BE0' };
    if (n.includes('matched')) return { background: '#E8F3EE', color: '#43B892' };
    if (n.includes('over')) return { background: '#FDF3F3', color: '#E57C7C' };
    if (n.includes('under')) return { background: '#FDF6EC', color: '#DBA14E' };
    return { background: '#232329', color: '#C9C7BF' };
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: '#908E85', borderBottom: '1px solid #2A2A30', whiteSpace: 'nowrap', background: '#232329', position: 'sticky', top: 0, zIndex: 2 };
  const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#C9C7BF', borderBottom: '1px solid #2A2A30', verticalAlign: 'top' };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="🪜" title="Exclusion Scheduling" subtitle="Accepted exclusion proposals with estimated job duration vs booked time"
        actions={<CCBtn variant="blue" onClick={refreshBookings} disabled={checking}>{checking ? '⏳ Checking…' : '↻ Check bookings'}</CCBtn>} />
      <p style={{ fontSize: 13, color: '#908E85', margin: '-14px 0 18px', lineHeight: 1.6, maxWidth: 900 }}>
        Accepted exclusion proposals with an estimated job duration (from home-feature quantities × the per-feature time standard, adjusted for stories + roof difficulty, plus a base buffer for paint + trapping). Once the PM schedules the job in FieldRoutes, the booked time is compared to the estimate.
      </p>

      {loading && <div style={{ fontSize: 14, color: '#908E85', padding: 20 }}>Loading…</div>}

      {data && !loading && (data.jobs || []).length === 0 && (
        <div style={{ fontSize: 14, color: '#908E85', padding: 20, background: '#232329', borderRadius: 10 }}>
          No accepted exclusion proposals yet. When a Permanent Rodent Solution proposal is accepted in SmarterLaunch, it will appear here with an estimate.
        </div>
      )}

      {data && (data.jobs || []).length > 0 && (
        <div style={{ border: '1px solid #2A2A30', borderRadius: 14, overflow: 'hidden', background: '#1C1C21' }}>
          <div style={{ maxHeight: 640, overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Customer</th>
                <th style={th}>PM</th>
                <th style={{ ...th, textAlign: 'center' }}>FR ID</th>
                <th style={{ ...th, textAlign: 'center' }}>Accepted</th>
                <th style={{ ...th, textAlign: 'center' }}>Stories</th>
                <th style={{ ...th, textAlign: 'center' }}>Roof</th>
                <th style={{ ...th, textAlign: 'right' }}>Excl. Revenue</th>
                <th style={{ ...th, textAlign: 'center' }}>Est. Hours</th>
                <th style={{ ...th, textAlign: 'center' }}>Booked</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}></th>
              </tr></thead>
              <tbody>
                {(data.jobs || []).map((j: any, i: number) => (
                  <>
                    <tr key={i} style={{ background: i % 2 ? '#1f1f24' : 'transparent' }}>
                      <td style={{ ...td, fontWeight: 600 }}>{j.customer || j.frCustomerId || '—'}</td>
                      <td style={{ ...td, color: '#C9C7BF' }}>{j.pm || '—'}</td>
                      <td style={{ ...td, textAlign: 'center', color: '#908E85' }}>{j.frCustomerId || '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{fmtDate(j.acceptedAt)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{j.stories || '—'}</td>
                      <td style={{ ...td, textAlign: 'center', textTransform: 'capitalize' }}>{j.difficulty || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{j.exclusionRevenue != null ? `$${j.exclusionRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: '#5B9BE0' }}>{j.estimatedHours != null ? `${j.estimatedHours}h` : (j.estimateError ? '⚠️' : '—')}</td>
                      <td style={{ ...td, textAlign: 'center' }} title={j.bookedWallClockHours != null ? `${j.bookedWallClockHours}h wall-clock × ${j.crewSize} tech${j.crewSize === 1 ? '' : 's'}` : ''}>{j.bookedHours != null ? <>{j.bookedHours}h{j.crewSize ? <span style={{ color: '#63615A', fontSize: 11 }}> ({j.bookedWallClockHours}h×{j.crewSize})</span> : null}</> : '—'}</td>
                      <td style={td}><span style={{ ...statusStyle(j.schedulingNote), fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{j.schedulingNote}</span></td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {j.breakdown && <button onClick={() => setExpanded(expanded === j.proposalUuid ? null : j.proposalUuid)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8', cursor: 'pointer' }}>{expanded === j.proposalUuid ? '▲' : '▼'}</button>}
                      </td>
                    </tr>
                    {expanded === j.proposalUuid && j.breakdown && (
                      <tr>
                        <td colSpan={11} style={{ padding: '4px 12px 14px 12px', background: '#232329', borderBottom: '0.5px solid #232329' }}>
                          <div style={{ fontSize: 12, color: '#C9C7BF' }}>
                            <div style={{ fontWeight: 600, margin: '6px 0' }}>{j.ruleOfThumb}</div>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                              <tbody>
                                {j.breakdown.map((b: any, k: number) => (
                                  <tr key={k}>
                                    <td style={{ padding: '2px 16px 2px 0', color: '#C9C7BF' }}>{b.feature}</td>
                                    <td style={{ padding: '2px 16px 2px 0', color: '#908E85' }}>{b.input}</td>
                                    <td style={{ padding: '2px 16px 2px 0', textAlign: 'right', fontWeight: 600 }}>{b.minutes} min</td>
                                    <td style={{ padding: '2px 0', color: '#63615A', fontSize: 11 }}>{b.note}</td>
                                  </tr>
                                ))}
                                <tr><td colSpan={2} style={{ padding: '4px 16px 2px 0', color: '#C9C7BF', fontWeight: 600 }}>Base buffer (paint run)</td><td style={{ padding: '4px 16px 2px 0', textAlign: 'right', fontWeight: 600 }}>{j.baseBuffer?.total ?? 35} min</td><td></td></tr>
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#63615A', lineHeight: 1.6, marginTop: 10 }}>
        Estimates fire automatically when a proposal is accepted in SmarterLaunch. Status: <b style={{ color: '#5B9BE0' }}>Pending scheduling appointment</b> → awaiting the PM to book it in FieldRoutes; then <b style={{ color: '#43B892' }}>matched</b> / <b style={{ color: '#E57C7C' }}>over-allotted</b> / <b style={{ color: '#DBA14E' }}>under-allotted</b> once booked.
      </p>
    </div>
  );
}
