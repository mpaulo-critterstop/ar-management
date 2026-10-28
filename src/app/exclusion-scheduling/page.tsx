'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';

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
    if (n.includes('pending')) return { background: '#FBF3E3', color: '#8A6D1F' };
    if (n.includes('matched')) return { background: '#E8F3EE', color: '#1D6E56' };
    if (n.includes('over')) return { background: '#FDF3F3', color: '#A32D2D' };
    if (n.includes('under')) return { background: '#FDF6EC', color: '#B5730F' };
    return { background: '#F1EFE8', color: '#6b6a64' };
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', verticalAlign: 'top' };

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
        <button onClick={refreshBookings} disabled={checking} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, border: 'none', background: checking ? '#F1EFE8' : '#1F3864', color: checking ? '#888' : '#fff', cursor: checking ? 'default' : 'pointer' }}>{checking ? '⏳ Checking FieldRoutes…' : '↻ Check bookings'}</button>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>🪜 Exclusion Scheduling</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 18px', lineHeight: 1.6 }}>
        Accepted exclusion proposals with an estimated job duration (from home-feature quantities × the per-feature time standard, adjusted for stories + roof difficulty, plus a base buffer for paint + trapping). Once the PM schedules the job in FieldRoutes, the booked time is compared to the estimate.
      </p>

      {loading && <div style={{ fontSize: 14, color: '#888780', padding: 20 }}>Loading…</div>}

      {data && !loading && (data.jobs || []).length === 0 && (
        <div style={{ fontSize: 14, color: '#888780', padding: 20, background: '#FBFBF9', borderRadius: 10 }}>
          No accepted exclusion proposals yet. When a Permanent Rodent Solution proposal is accepted in SmarterLaunch, it will appear here with an estimate.
        </div>
      )}

      {data && (data.jobs || []).length > 0 && (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
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
                    <tr key={i} style={{ background: i % 2 ? '#FBFBF9' : undefined }}>
                      <td style={{ ...td, fontWeight: 600 }}>{j.customer || j.frCustomerId || '—'}</td>
                      <td style={{ ...td, color: '#555' }}>{j.pm || '—'}</td>
                      <td style={{ ...td, textAlign: 'center', color: '#888780' }}>{j.frCustomerId || '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{fmtDate(j.acceptedAt)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{j.stories || '—'}</td>
                      <td style={{ ...td, textAlign: 'center', textTransform: 'capitalize' }}>{j.difficulty || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{j.exclusionRevenue != null ? `$${j.exclusionRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: '#1F3864' }}>{j.estimatedHours != null ? `${j.estimatedHours}h` : (j.estimateError ? '⚠️' : '—')}</td>
                      <td style={{ ...td, textAlign: 'center' }} title={j.bookedWallClockHours != null ? `${j.bookedWallClockHours}h wall-clock × ${j.crewSize} tech${j.crewSize === 1 ? '' : 's'}` : ''}>{j.bookedHours != null ? <>{j.bookedHours}h{j.crewSize ? <span style={{ color: '#B4B2A9', fontSize: 11 }}> ({j.bookedWallClockHours}h×{j.crewSize})</span> : null}</> : '—'}</td>
                      <td style={td}><span style={{ ...statusStyle(j.schedulingNote), fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{j.schedulingNote}</span></td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {j.breakdown && <button onClick={() => setExpanded(expanded === j.proposalUuid ? null : j.proposalUuid)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #D9D9D9', background: '#fff', cursor: 'pointer' }}>{expanded === j.proposalUuid ? '▲' : '▼'}</button>}
                      </td>
                    </tr>
                    {expanded === j.proposalUuid && j.breakdown && (
                      <tr>
                        <td colSpan={11} style={{ padding: '4px 12px 14px 12px', background: '#FBFBF9', borderBottom: '0.5px solid #F1EFE8' }}>
                          <div style={{ fontSize: 12, color: '#555' }}>
                            <div style={{ fontWeight: 600, margin: '6px 0' }}>{j.ruleOfThumb}</div>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                              <tbody>
                                {j.breakdown.map((b: any, k: number) => (
                                  <tr key={k}>
                                    <td style={{ padding: '2px 16px 2px 0', color: '#6b6a64' }}>{b.feature}</td>
                                    <td style={{ padding: '2px 16px 2px 0', color: '#888780' }}>{b.input}</td>
                                    <td style={{ padding: '2px 16px 2px 0', textAlign: 'right', fontWeight: 600 }}>{b.minutes} min</td>
                                    <td style={{ padding: '2px 0', color: '#B4B2A9', fontSize: 11 }}>{b.note}</td>
                                  </tr>
                                ))}
                                <tr><td colSpan={2} style={{ padding: '4px 16px 2px 0', color: '#6b6a64', fontWeight: 600 }}>Base buffer (paint + trapping)</td><td style={{ padding: '4px 16px 2px 0', textAlign: 'right', fontWeight: 600 }}>65 min</td><td></td></tr>
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

      <p style={{ fontSize: 11, color: '#B4B2A9', lineHeight: 1.6, marginTop: 10 }}>
        Estimates fire automatically when a proposal is accepted in SmarterLaunch. Status: <b>Pending scheduling appointment</b> → awaiting the PM to book it in FieldRoutes; then <b style={{ color: '#1D6E56' }}>matched</b> / <b style={{ color: '#A32D2D' }}>over-allotted</b> / <b style={{ color: '#B5730F' }}>under-allotted</b> once booked.
      </p>
    </div>
  );
}
