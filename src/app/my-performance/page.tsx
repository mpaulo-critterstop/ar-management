'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pct(v: number | null) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function scoreColor(s: number | null) {
  if (!s) return '#94a3b8';
  return s >= 0.90 ? '#22c55e' : s >= 0.75 ? '#f59e0b' : '#ef4444';
}

function scoreBg(s: number | null) {
  if (!s) return 'rgba(148,163,184,0.1)';
  return s >= 0.90 ? 'rgba(34,197,94,0.12)' : s >= 0.75 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
}

function teamColor(t: string) {
  return t === 'WP' ? '#3b82f6' : t === 'PMP' ? '#10b981' : '#a855f7';
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100svh', background: '#0052cc' }}>
      <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading...</div>
    </div>
  );

  if (!data || data.error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100svh', background: '#0052cc', gap: 12 }}>
      <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '0 32px' }}>{data?.error || 'No performance data found.'}</div>
      <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
    </div>
  );

  const { technician, latest, weeks, monthly, ytd } = data;
  const score = latest?.totalScore ?? null;

  return (
    <div style={{ background: '#001a4d', minHeight: '100svh', color: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', maxWidth: 480, margin: '0 auto' }}>
      
      {/* Status bar spacer */}
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div style={{ padding: '16px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${teamColor(technician.team)}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: teamColor(technician.team) }}>
            {technician.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{technician.name}</div>
            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
              <span style={{ color: teamColor(technician.team), fontWeight: 500 }}>{technician.team}</span>
              <span>·</span><span>{technician.office}</span>
              {technician.crewLeader && technician.crewLeader !== technician.name && <><span>·</span><span>{technician.crewLeader}</span></>}
            </div>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          style={{ fontSize: 12, color: '#475569', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', padding: '16px 20px 0', gap: 4 }}>
        {(['overview', 'history', 'trend'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 500, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: activeTab === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === tab ? '#f8fafc' : '#64748b' }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 16px 40px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Big score */}
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '28px 20px', textAlign: 'center', border: `1px solid ${score ? scoreColor(score) + '33' : 'rgba(255,255,255,0.08)'}` }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                {latest ? `Week of ${fmtWeek(latest.weekEnd)}` : 'No data yet'}
              </div>
              <div style={{ fontSize: 64, fontWeight: 800, color: scoreColor(score), lineHeight: 1, letterSpacing: '-2px' }}>
                {pct(score)}
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>Weekly Score</div>
              {ytd !== null && (
                <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, padding: '6px 14px' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>YTD</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(ytd) }}>{pct(ytd)}</span>
                </div>
              )}
            </div>

            {/* Breakdown */}
            {latest && (
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Score Breakdown</div>
                {[
                  ...(technician.team === 'WP' ? [
                    { label: 'Close-out %', sub: '45% weight · Target ≥85%', value: pct(latest.closeOutPct), good: (latest.closeOutPct ?? 0) >= 0.85 },
                    { label: 'Callback rate', sub: '30% weight · Target ≤15%', value: pct(latest.callbackRate), good: (latest.callbackRate ?? 1) <= 0.15 },
                  ] : []),
                  ...(technician.team === 'PMP' ? [
                    { label: 'Revenue efficiency', sub: '35% weight · Target ≥90%', value: pct(latest.revenueEfficiency), good: (latest.revenueEfficiency ?? 0) >= 0.90 },
                    { label: 'Reservice rate', sub: '20% weight · Target ≤10%', value: pct(latest.reseviceRate), good: (latest.reseviceRate ?? 1) <= 0.10 },
                    { label: 'Completion %', sub: '20% weight · Target ≥95%', value: pct(latest.completionPct), good: (latest.completionPct ?? 0) >= 0.95 },
                  ] : []),
                  { label: 'Driving score', sub: (technician.team === 'IP' ? '50%' : '10%') + ' weight · Target ≥90%', value: pct(latest.drivingScore), good: (latest.drivingScore ?? 0) >= 0.90 },
                  { label: 'Reliability', sub: (technician.team === 'IP' ? '50%' : '15%') + ' weight · Target ≥90%', value: pct(latest.reliabilityScore), good: (latest.reliabilityScore ?? 0) >= 0.90 },
// Manual adjustment hidden from tech view
                ].map((row, i, arr) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                    <div>
                      <div style={{ fontSize: 14, color: '#e2e8f0' }}>{row.label}</div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{row.sub}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: row.good ? '#22c55e' : '#f59e0b' }}>{row.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Monthly grid */}
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>This Year</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  return (
                    <div key={m} style={{ textAlign: 'center', padding: '10px 4px', borderRadius: 12, background: s ? scoreBg(s) : 'rgba(255,255,255,0.03)', border: `1px solid ${s ? scoreColor(s) + '33' : 'rgba(255,255,255,0.06)'}` }}>
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>{m}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: s ? scoreColor(s) : '#334155' }}>{s ? (s * 100).toFixed(0) + '%' : '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {weeks.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: 48, fontSize: 14 }}>No history yet.</div>
            ) : weeks.map((w: any) => (
              <div key={w.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#cbd5e1' }}>Week of {fmtWeek(w.weekEnd)}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor(w.totalScore) }}>{pct(w.totalScore)}</div>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 2 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
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
                    <div key={item.label} style={{ textAlign: 'center', padding: '7px 4px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TREND */}
        {activeTab === 'trend' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Bar chart */}
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Monthly Average</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 100 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  const h = s ? Math.max((s / 1.1) * 100, 5) : 0;
                  return (
                    <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      {s && <div style={{ fontSize: 8, color: scoreColor(s), fontWeight: 700 }}>{(s*100).toFixed(0)}</div>}
                      <div style={{ width: '100%', height: `${h}%`, background: s ? scoreColor(s) : 'rgba(255,255,255,0.06)', borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      <div style={{ fontSize: 8, color: '#334155' }}>{m}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#475569', textAlign: 'center' }}>
                YTD avg: <span style={{ fontWeight: 700, color: scoreColor(ytd) }}>{pct(ytd)}</span>
                <span style={{ color: '#334155' }}> · Target: 90%</span>
              </div>
            </div>

            {/* Weekly trend */}
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Last 8 Weeks</div>
              {weeks.slice(0, 8).reverse().map((w: any) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#475569', width: 46, flexShrink: 0 }}>{fmtWeek(w.weekEnd)}</div>
                  <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(w.totalScore), width: 46, textAlign: 'right', flexShrink: 0 }}>{pct(w.totalScore)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom safe area */}
      <div style={{ height: 'env(safe-area-inset-bottom, 20px)' }} />
    </div>
  );
}
