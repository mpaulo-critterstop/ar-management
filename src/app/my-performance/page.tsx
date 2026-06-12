'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pct(v: number | null) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function scoreColor(score: number | null) {
  if (!score) return '#94a3b8';
  return score >= 0.90 ? '#27500A' : score >= 0.75 ? '#633806' : '#791F1F';
}

function scoreBg(score: number | null) {
  if (!score) return '#f1f5f9';
  return score >= 0.90 ? '#EAF3DE' : score >= 0.75 ? '#FAEEDA' : '#FCEBEB';
}

function teamColor(team: string) {
  return team === 'WP' ? '#0C447C' : team === 'PMP' ? '#085041' : '#72243E';
}

function teamBg(team: string) {
  return team === 'WP' ? '#E6F1FB' : team === 'PMP' ? '#E1F5EE' : '#FBEAF0';
}

function fmtWeek(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function MyPerformancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'trend'>('overview');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/my-performance')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [status]);

  if (status === 'loading' || loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontSize: 14 }}>
      Loading...
    </div>
  );

  if (!data || data.error) return (
    <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
      {data?.error || 'No performance data found.'}
    </div>
  );

  const { technician, latest, weeks, monthly, ytd } = data;
  const score = latest?.totalScore ?? null;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 500,
    color: active ? '#0052cc' : '#64748b',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid #0052cc' : '2px solid transparent',
    cursor: 'pointer',
  });

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* Header */}
      <div style={{ background: '#fff', padding: '20px 20px 0', borderBottom: '0.5px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: teamBg(technician.team), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, color: teamColor(technician.team), flexShrink: 0 }}>
            {technician.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{technician.name}</div>
            <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
              <span style={{ background: teamBg(technician.team), color: teamColor(technician.team), fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 99 }}>{technician.team}</span>
              <span>{technician.office}</span>
              {technician.crewLeader && <span>· {technician.crewLeader}</span>}
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: 'flex', borderTop: '0.5px solid #f1f5f9' }}>
          {(['overview', 'history', 'trend'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={tabStyle(activeTab === tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div>
            {/* Big score card */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 12, textAlign: 'center', border: '0.5px solid #e2e8f0' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                {latest ? `Week of ${fmtWeek(latest.weekEnd)}` : 'No data yet'}
              </div>
              <div style={{ fontSize: 56, fontWeight: 700, color: scoreColor(score), lineHeight: 1 }}>
                {pct(score)}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Weekly Score</div>
              {ytd !== null && (
                <div style={{ marginTop: 12, padding: '8px 16px', background: '#f8fafc', borderRadius: 99, display: 'inline-block' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>YTD avg: </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: scoreColor(ytd) }}>{pct(ytd)}</span>
                </div>
              )}
            </div>

            {/* Score breakdown */}
            {latest && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '0.5px solid #e2e8f0', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>Score Breakdown</div>
                {[
                  ...(technician.team === 'WP' ? [
                    { label: 'Close-out %', value: pct(latest.closeOutPct), weight: '45%', good: (latest.closeOutPct ?? 0) >= 0.85 },
                    { label: 'Callback rate', value: pct(latest.callbackRate), weight: '30%', good: (latest.callbackRate ?? 1) <= 0.15, invert: true },
                  ] : []),
                  ...(technician.team === 'PMP' ? [
                    { label: 'Revenue efficiency', value: pct(latest.revenueEfficiency), weight: '35%', good: (latest.revenueEfficiency ?? 0) >= 0.90 },
                    { label: 'Reservice rate', value: pct(latest.reseviceRate), weight: '20%', good: (latest.reseviceRate ?? 1) <= 0.10, invert: true },
                    { label: 'Completion %', value: pct(latest.completionPct), weight: '20%', good: (latest.completionPct ?? 0) >= 0.95 },
                  ] : []),
                  { label: 'Driving score', value: pct(latest.drivingScore), weight: technician.team === 'IP' ? '50%' : '10%', good: (latest.drivingScore ?? 0) >= 0.90 },
                  { label: 'Reliability', value: pct(latest.reliabilityScore), weight: technician.team === 'IP' ? '50%' : '15%', good: (latest.reliabilityScore ?? 0) >= 0.90 },
                  ...(latest.manualAdj && latest.manualAdj !== 0 ? [
                    { label: 'Manual adjustment', value: (latest.manualAdj > 0 ? '+' : '') + (latest.manualAdj * 100).toFixed(1) + '%', weight: '', good: latest.manualAdj > 0 },
                  ] : []),
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '0.5px solid #f1f5f9' }}>
                    <div>
                      <div style={{ fontSize: 13, color: '#0f172a' }}>{row.label}</div>
                      {row.weight && <div style={{ fontSize: 11, color: '#94a3b8' }}>{row.weight} weight</div>}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: row.good ? '#27500A' : '#854F0B' }}>{row.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Monthly snapshot */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '0.5px solid #e2e8f0' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>This Year</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  return (
                    <div key={m} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: s ? scoreBg(s) : '#f8fafc' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>{m}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: s ? scoreColor(s) : '#94a3b8' }}>{s ? (s * 100).toFixed(0) + '%' : '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div>
            {weeks.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40, fontSize: 14 }}>No history yet.</div>
            ) : weeks.map((w: any) => (
              <div key={w.id} style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, border: '0.5px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>Week of {fmtWeek(w.weekEnd)}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: scoreColor(w.totalScore) }}>{pct(w.totalScore)}</div>
                </div>
                {/* Mini bar */}
                <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 2 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                  {[
                    ...(technician.team === 'WP' ? [
                      { label: 'CO%', value: pct(w.closeOutPct) },
                      { label: 'CB rate', value: pct(w.callbackRate) },
                    ] : []),
                    ...(technician.team === 'PMP' ? [
                      { label: 'Rev eff', value: pct(w.revenueEfficiency) },
                      { label: 'Reservice', value: pct(w.reseviceRate) },
                    ] : []),
                    { label: 'Driving', value: pct(w.drivingScore) },
                    { label: 'Reliability', value: pct(w.reliabilityScore) },
                  ].map(item => (
                    <div key={item.label} style={{ textAlign: 'center', padding: '6px 4px', background: '#f8fafc', borderRadius: 6 }}>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{item.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#0f172a' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TREND TAB */}
        {activeTab === 'trend' && (
          <div>
            {/* Monthly trend bars */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '0.5px solid #e2e8f0', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 16 }}>Monthly Average</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  const h = s ? Math.max((s / 1.1) * 100, 4) : 0;
                  return (
                    <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {s && <div style={{ fontSize: 9, color: scoreColor(s), fontWeight: 600 }}>{(s*100).toFixed(0)}</div>}
                      <div style={{ width: '100%', height: `${h}%`, background: s ? scoreColor(s) : '#f1f5f9', borderRadius: '3px 3px 0 0', minHeight: s ? 4 : 2, opacity: s ? 1 : 0.3 }} />
                      <div style={{ fontSize: 9, color: '#94a3b8' }}>{m}</div>
                    </div>
                  );
                })}
              </div>
              {/* Target line label */}
              <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                Target: 90% · YTD: <span style={{ fontWeight: 600, color: scoreColor(ytd) }}>{pct(ytd)}</span>
              </div>
            </div>

            {/* Component trends */}
            {weeks.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '0.5px solid #e2e8f0' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>Last 8 Weeks</div>
                {weeks.slice(0, 8).reverse().map((w: any) => (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', width: 48, flexShrink: 0 }}>{fmtWeek(w.weekEnd)}</div>
                    <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 3, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: scoreColor(w.totalScore), width: 44, textAlign: 'right', flexShrink: 0 }}>{pct(w.totalScore)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
