'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';

const RANGES = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This week', value: 'this_week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'Last 7 days', value: 'last_7' },
  { label: 'Last 30 days', value: 'last_30' },
  { label: 'This month', value: 'current_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'Custom', value: 'custom' },
];

function fmtDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: any; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: '14px 18px', borderLeft: `3px solid ${color || '#0052cc'}` }}>
      <div style={{ fontSize: 11, color: '#888780', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 500, color: '#2C2C2A' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function CallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [range, setRange] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && !canAccessModule(session?.user as any, 'dialpad')) router.replace('/');
  }, [status, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ range });
    if (range === 'custom' && customStart && customEnd) { params.set('start', customStart); params.set('end', customEnd); }
    const res = await fetch(`/api/dialpad/calls?${params}`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [range, customStart, customEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  const role = (session?.user as any)?.role;
  if (status === 'loading') return null;

  const answerRate = data ? Math.round((data.answered / Math.max(data.total, 1)) * 100) : 0;

  // Build daily chart data
  const dailyEntries = data ? Object.entries(data.daily_volume || {}).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Dialpad Call Analytics</h1>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {RANGES.map(r => (
            <button key={r.value}
              onClick={() => { setRange(r.value); setShowCustom(r.value === 'custom'); }}
              style={{
                padding: '7px 14px', fontSize: 13, fontWeight: 500, borderRadius: 9,
                color: range === r.value ? '#2C2C2A' : '#888780',
                background: range === r.value ? '#fff' : 'transparent',
                border: range === r.value ? '0.5px solid #D3D1C7' : '0.5px solid transparent',
                boxShadow: range === r.value ? '0 1px 3px rgba(44,44,42,0.08)' : 'none',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {r.label}
            </button>
          ))}
        </div>
        {showCustom && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              style={{ fontSize: 12, padding: '6px 10px', border: '0.5px solid #D3D1C7', borderRadius: 8, background: '#fff', color: '#2C2C2A' }} />
            <span style={{ fontSize: 12, color: '#888780' }}>to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              style={{ fontSize: 12, padding: '6px 10px', border: '0.5px solid #D3D1C7', borderRadius: 8, background: '#fff', color: '#2C2C2A' }} />
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total inbound" value={loading ? '…' : (data?.total || 0).toLocaleString()} color="#0052cc" />
        <KpiCard label="Answered" value={loading ? '…' : (data?.answered || 0).toLocaleString()} sub={`${answerRate}% answer rate`} color="#2d9e5f" />
        <KpiCard label="Agent missed" value={loading ? '…' : (data?.agent_missed || 0).toLocaleString()} sub={data ? `${(data.ring_no_answer||0).toLocaleString()} ring no answer · ${(data.voicemail||0).toLocaleString()} voicemail` : 'Rang but not answered'} color="#f5a623" />
        <KpiCard label="Missed opportunity" value={loading ? '…' : (data?.missed_opportunity || 0).toLocaleString()} sub="No agent reached" color="#e24b4a" />
        <KpiCard label="First-time callers" value={loading ? '…' : (data?.first_time || 0).toLocaleString()} sub="New leads" color="#7b2fbe" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Daily volume chart — matching old app style */}
        <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>Call volume</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Answered vs missed by day</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#666' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#4A90D9' }} /> Answered
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#666' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#E24B4A' }} /> Missed
            </div>
          </div>
          {loading || dailyEntries.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>{loading ? 'Loading...' : 'No data'}</div>
          ) : (() => {
            const maxVol = Math.max(...dailyEntries.map(([, v]: any) => (v.answered || 0) + (v.missed || 0)));
            const ySteps = [0, Math.round(maxVol * 0.25), Math.round(maxVol * 0.5), Math.round(maxVol * 0.75), maxVol];
            return (
              <div style={{ display: 'flex', gap: 0 }}>
                {/* Y axis */}
                <div style={{ display: 'flex', flexDirection: 'column-reverse', justifyContent: 'space-between', paddingRight: 6, height: 160 }}>
                  {ySteps.map(v => (
                    <div key={v} style={{ fontSize: 9, color: '#bbb', textAlign: 'right' }}>{v}</div>
                  ))}
                </div>
                {/* Chart area */}
                <div style={{ flex: 1, position: 'relative' }}>
                  {/* Grid lines */}
                  {ySteps.map((_, i) => (
                    <div key={i} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(i / (ySteps.length - 1)) * 100}%`, borderTop: '1px solid #F1EFE8' }} />
                  ))}
                  {/* Bars */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: 160, gap: 2 }}>
                    {dailyEntries.map(([date, vol]: any) => {
                      const answered = vol.answered || 0;
                      const missed = vol.missed || 0;
                      const total = answered + missed;
                      const totalH = maxVol > 0 ? (total / maxVol) * 160 : 0;
                      const answeredH = total > 0 ? (answered / total) * totalH : 0;
                      const missedH = totalH - answeredH;
                      const day = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                      return (
                        <div key={date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                          title={`${day}: ${answered} answered, ${missed} missed`}>
                          <div style={{ width: '80%', display: 'flex', flexDirection: 'column-reverse' }}>
                            <div style={{ height: answeredH, background: '#4A90D9', borderRadius: '2px 2px 0 0' }} />
                            <div style={{ height: missedH, background: '#E24B4A', borderRadius: missedH > 0 ? '2px 2px 0 0' : 0 }} />
                          </div>
                          <div style={{ fontSize: 8, color: '#bbb', marginTop: 3, textAlign: 'center' }}>{day}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Caller breakdown donut — placeholder matching old app */}
        <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>Caller breakdown</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 16 }}>First-time vs repeat</div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>Loading...</div>
          ) : (() => {
            const ft = data?.first_time || 0;
            const total = data?.total || 0;
            const repeat = total - ft;
            const ftPct = total > 0 ? Math.round((ft / total) * 100) : 0;
            const repeatPct = 100 - ftPct;
            const circ = 2 * Math.PI * 40;
            const ftDash = (ftPct / 100) * circ;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <svg width={100} height={100} viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#E8E7E3" strokeWidth="14" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#2d9e5f" strokeWidth="14"
                    strokeDasharray={`${ftDash} ${circ - ftDash}`} strokeDashoffset={circ / 4}
                    transform="rotate(-90 50 50)" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#4A90D9" strokeWidth="14"
                    strokeDasharray={`${circ - ftDash} ${ftDash}`} strokeDashoffset={circ / 4 - ftDash}
                    transform="rotate(-90 50 50)" />
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: '#2d9e5f' }} />
                    <div>
                      <div style={{ fontSize: 12, color: '#888' }}>First-time</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{ft.toLocaleString()} <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>{ftPct}%</span></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: '#4A90D9' }} />
                    <div>
                      <div style={{ fontSize: 12, color: '#888' }}>Repeat</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{repeat.toLocaleString()} <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>{repeatPct}%</span></div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Tracking number tables — side by side like old app */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Calls per tracking number */}
        <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>Calls per tracking number</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Total volume by line</div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>Loading...</div>
          ) : (() => {
            const entries = Object.entries(data?.tracking_numbers || {}).sort(([, a]: any, [, b]: any) => b - a);
            const max = entries.length > 0 ? (entries[0][1] as number) : 1;
            return entries.length === 0
              ? <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>No data</div>
              : <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                  {entries.map(([num, count]: any) => (
                    <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid #F1EFE8' }}>
                      <div style={{ fontSize: 12, color: '#1a1a1a', width: 130, flexShrink: 0 }}>{num}</div>
                      <div style={{ flex: 1, height: 6, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: '#4A90D9', borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', width: 36, textAlign: 'right' }}>{count}</div>
                    </div>
                  ))}
                </div>;
          })()}
        </div>

        {/* First-time callers by tracking number */}
        <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 }}>First-time callers by tracking number</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>New leads per line</div>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>Loading...</div>
          ) : (() => {
            const entries = Object.entries(data?.first_time_by_tracking || {})
              .sort(([, a]: any, [, b]: any) => b.first_time - a.first_time)
              .filter(([, v]: any) => v.first_time > 0);
            const max = entries.length > 0 ? (entries[0][1] as any).first_time : 1;
            return entries.length === 0
              ? <div style={{ textAlign: 'center', color: '#bbb', padding: 32, fontSize: 13 }}>No data</div>
              : <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                  {entries.map(([num, v]: any) => (
                    <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid #F1EFE8' }}>
                      <div style={{ fontSize: 12, color: '#1a1a1a', width: 130, flexShrink: 0 }}>{num}</div>
                      <div style={{ flex: 1, height: 6, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(v.first_time / max) * 100}%`, height: '100%', background: '#2d9e5f', borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', width: 36, textAlign: 'right' }}>{v.first_time}</div>
                    </div>
                  ))}
                </div>;
          })()}
        </div>
      </div>

      {/* Agent performance table */}
      <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 2px', fontSize: 13, fontWeight: 500, color: '#2C2C2A' }}>Agent performance</div>
        <div style={{ fontSize: 11, color: '#888780', padding: '0 16px 10px' }}>Inbound calls only</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {['Agent', 'Total', 'Answered', 'Missed', 'First-time', 'Answer rate', 'Avg duration'].map(h => (
                  <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', padding: '8px 12px', borderBottom: '0.5px solid #E8E7E3', background: '#F8F7F4', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>Loading...</td></tr>
              ) : !data?.agent_stats?.length ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>No data for this period</td></tr>
              ) : (data.agent_stats as any[]).map((agent: any) => {
                const ar = Math.round((agent.answered / Math.max(agent.total, 1)) * 100);
                const avgDur = agent.answered > 0 ? Math.round(agent.totalDuration / agent.answered) : 0;
                return (
                  <tr key={agent.name}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                    <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500, color: '#2C2C2A' }}>{agent.name}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#2C2C2A' }}>{agent.total}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#1D9E75' }}>{agent.answered}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: agent.missed > 0 ? '#A32D2D' : '#B4B2A9' }}>{agent.missed}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#534AB7' }}>{agent.first_time || 0}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 5, background: '#E8E7E3', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${ar}%`, height: '100%', background: ar >= 80 ? '#1D9E75' : ar >= 60 ? '#BA7517' : '#A32D2D', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 12, color: '#2C2C2A' }}>{ar}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888780' }}>{fmtDuration(avgDur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
