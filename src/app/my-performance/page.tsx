'use client';
import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Theme (Option 1): baby-blue surface, lighter warm-brown accents. Scores stay green/amber/red.
const T = {
  bg: '#CFE2F3',          // baby blue page (more saturated / bluer)
  card: '#FFFFFF',        // white cards
  cardSoft: '#DDEBF8',    // deeper blue tint for nested/empty
  brown: '#8A6A44',       // lighter, warmer brown accent
  brownDark: '#75593A',
  brownText: '#8A6A44',   // lighter brown label text
  cream: '#FFFFFF',       // text on brown accent
  creamDim: '#EFE3D2',
  ink: '#2C2C2A',         // primary text
  muted: '#6E6C66',       // muted text (a touch darker for contrast on bluer bg)
  faint: '#9C9A92',       // faint text
  line: 'rgba(138,106,68,0.14)', // hairline (warm-brown tint)
};

function pct(v: number | null) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function scoreColor(s: number | null) {
  if (!s) return '#94a3b8';
  return s >= 0.90 ? '#22c55e' : s >= 0.75 ? '#f59e0b' : '#ef4444';
}

function scoreBg(s: number | null) {
  if (!s) return 'rgba(148,163,184,0.12)';
  return s >= 0.90 ? 'rgba(34,197,94,0.14)' : s >= 0.75 ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.12)';
}

function teamColor(t: string) {
  return t === 'WP' ? '#185FA5' : t === 'PMP' ? '#0F6E56' : '#6B4E2E';
}

function fmtWeek(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Team sub-view metric definitions. lowerIsBetter controls both sort direction and the good/bad color.
const TC_METRICS = [
  { key: 'closeOutPct', label: 'Close Out %', fmt: (v: number) => (v * 100).toFixed(1) + '%', lowerIsBetter: false, good: (v: number) => v >= 0.85 },
  { key: 'callbackRate', label: 'Callback Rate', fmt: (v: number) => (v * 100).toFixed(1) + '%', lowerIsBetter: true, good: (v: number) => v <= 0.15 },
] as const;
const DRIVING_METRICS = [
  { key: 'maxSpeed', label: 'Max Speed', fmt: (v: number) => Math.round(v) + ' mph', lowerIsBetter: true, good: (v: number) => v <= 80 },
  { key: 'safetyAlertsPer1k', label: 'Alerts / 1k mi', fmt: (v: number) => v.toFixed(1), lowerIsBetter: true, good: (v: number) => v <= 5 },
  { key: 'idleRatio', label: 'Idle Ratio', fmt: (v: number) => (v * 100).toFixed(1) + '%', lowerIsBetter: true, good: (v: number) => v <= 0.15 },
] as const;
// PMP-specific: PC Routes production/completion/revEff, and reservice rate.
const ROUTES_METRICS = [
  { key: 'revenueEfficiency', label: 'Rev Eff', fmt: (v: number) => (v * 100).toFixed(0) + '%', lowerIsBetter: false, good: (v: number) => v >= 0.90 },
  { key: 'completionPct', label: 'Completion', fmt: (v: number) => (v * 100).toFixed(0) + '%', lowerIsBetter: false, good: (v: number) => v >= 0.95 },
  { key: 'productionValue', label: 'Production', fmt: (v: number) => '$' + Math.round(v).toLocaleString(), lowerIsBetter: false, good: () => true },
] as const;
const RESERVICE_METRICS = [
  { key: 'reseviceRate', label: 'Reservice Rate', fmt: (v: number) => (v * 100).toFixed(1) + '%', lowerIsBetter: true, good: (v: number) => v <= 0.10 },
] as const;

function sortByMetric(members: any[], key: string, lowerIsBetter: boolean) {
  return [...members].filter(m => m.latest && m.latest[key] !== null && m.latest[key] !== undefined)
    .sort((a, b) => lowerIsBetter ? a.latest[key] - b.latest[key] : b.latest[key] - a.latest[key]);
}

export default function MyPerformancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'trend' | 'team'>('overview');

  const isTeamLeader = !!(session?.user as any)?.permissions?.isTeamLeader;
  const [teamData, setTeamData] = useState<any>(null);
  const [teamView, setTeamView] = useState<'roster' | 'tc' | 'routes' | 'reservice' | 'driving' | 'attendance'>('roster');
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [tcMetric, setTcMetric] = useState(0);       // index into TC_METRICS
  const [drivingMetric, setDrivingMetric] = useState(0); // index into DRIVING_METRICS
  const [routesMetric, setRoutesMetric] = useState(0);   // index into ROUTES_METRICS
  const [teamWeek, setTeamWeek] = useState<string>('');   // selected week for team view (blank = latest)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && (session?.user as any)?.mustChangePassword) router.replace('/change-password');
  }, [status, router, session]);

  useEffect(() => {
    if (status !== 'authenticated' || !isTeamLeader) return;
    const url = teamWeek ? `/api/my-team?weekEnd=${teamWeek}` : '/api/my-team';
    fetch(url).then(r => r.ok ? r.json() : null).then(setTeamData).catch(() => {});
  }, [status, isTeamLeader, teamWeek]);

  // When team data (re)loads, default the sub-view to roster (valid for every team).
  useEffect(() => { setTeamView('roster'); }, [teamData?.leader?.team]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/my-performance')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [status]);

  if (status === 'loading' || loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100svh', background: T.bg }}>
      <div style={{ color: T.brownText, fontSize: 14 }}>Loading...</div>
    </div>
  );

  if (!data || data.error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100svh', background: T.bg, gap: 12 }}>
      <div style={{ color: T.muted, fontSize: 14, textAlign: 'center', padding: '0 32px' }}>{data?.error || 'No performance data found.'}</div>
      <button onClick={() => signOut({ callbackUrl: '/login' })} style={{ fontSize: 13, color: T.cream, background: T.brown, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Sign out</button>
    </div>
  );

  const { technician, latest, weeks, monthly, ytd } = data;
  const score = latest?.totalScore ?? null;

  return (
    <div style={{ background: T.bg, minHeight: '100svh', color: T.ink, colorScheme: 'light', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', maxWidth: 480, margin: '0 auto' }}>
      
      {/* Status bar spacer */}
      <div style={{ height: 'env(safe-area-inset-top, 0px)', background: T.bg }} />

      {/* Header — light, brown accents */}
      <div style={{ padding: '16px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: T.brown, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>
            {technician.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{technician.name}</div>
            <div style={{ fontSize: 11, color: T.muted, display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
              <span style={{ color: T.brownText, fontWeight: 500 }}>{technician.team}</span>
              <span>·</span><span>{technician.office}</span>
              {technician.crewLeader && technician.crewLeader !== technician.name && <><span>·</span><span>{technician.crewLeader}</span></>}
            </div>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          style={{ fontSize: 12, color: T.brownText, background: 'rgba(138,106,68,0.10)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', padding: '16px 20px 0', gap: 4 }}>
        {(['overview', 'history', 'trend', 'team'] as const).filter(t => t !== 'team' || isTeamLeader).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 500, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: activeTab === tab ? T.brown : 'rgba(138,106,68,0.10)',
              color: activeTab === tab ? '#fff' : T.brownText }}>
            {tab === 'team' ? 'My Team' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 16px 40px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Big score */}
            <div style={{ background: T.card, borderRadius: 20, padding: '28px 20px', textAlign: 'center', border: `1px solid ${score ? scoreColor(score) + '33' : T.line}` }}>
              <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
                {latest ? `Week of ${fmtWeek(latest.weekEnd)}` : 'No data yet'}
              </div>
              <div style={{ fontSize: 64, fontWeight: 800, color: scoreColor(score), lineHeight: 1, letterSpacing: '-2px' }}>
                {pct(score)}
              </div>
              <div style={{ fontSize: 12, color: T.faint, marginTop: 6 }}>Weekly Score</div>
              {ytd !== null && (
                <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, background: T.cardSoft, borderRadius: 99, padding: '6px 14px' }}>
                  <span style={{ fontSize: 12, color: T.brownText }}>YTD</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(ytd) }}>{pct(ytd)}</span>
                </div>
              )}
            </div>

            {/* Breakdown */}
            {latest && (
              <div style={{ background: T.card, borderRadius: 20, padding: '16px 20px', border: `1px solid ${T.line}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.brownText, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Score Breakdown</div>
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
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: i < arr.length - 1 ? `1px solid ${T.line}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: 14, color: T.ink }}>{row.label}</div>
                      <div style={{ fontSize: 11, color: T.faint, marginTop: 1 }}>{row.sub}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: row.good ? '#16a34a' : '#d97706' }}>{row.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Monthly grid */}
            <div style={{ background: T.card, borderRadius: 20, padding: '16px 20px', border: `1px solid ${T.line}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.brownText, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>This Year</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  return (
                    <div key={m} style={{ textAlign: 'center', padding: '10px 4px', borderRadius: 12, background: s ? scoreBg(s) : T.cardSoft, border: `1px solid ${s ? scoreColor(s) + '33' : T.line}` }}>
                      <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>{m}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: s ? scoreColor(s) : T.faint }}>{s ? (s * 100).toFixed(0) + '%' : '—'}</div>
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
              <div style={{ textAlign: 'center', color: '#7C7A73', padding: 48, fontSize: 14 }}>No history yet.</div>
            ) : weeks.map((w: any) => (
              <div key={w.id} style={{ background: '#FFFFFF', borderRadius: 16, padding: 16, border: '1px solid rgba(138,106,68,0.14)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#2C2C2A' }}>Week of {fmtWeek(w.weekEnd)}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor(w.totalScore) }}>{pct(w.totalScore)}</div>
                </div>
                <div style={{ height: 3, background: 'rgba(138,106,68,0.14)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 2 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {[
                    ...(technician.team === 'WP' ? [
                      { label: 'CO%', value: pct(w.closeOutPct), good: (w.closeOutPct ?? 0) >= 0.85 },
                      { label: 'CB rate', value: pct(w.callbackRate), good: (w.callbackRate ?? 1) <= 0.15 },
                    ] : []),
                    ...(technician.team === 'PMP' ? [
                      { label: 'Rev eff', value: pct(w.revenueEfficiency), good: (w.revenueEfficiency ?? 0) >= 0.90 },
                      { label: 'Reservice', value: pct(w.reseviceRate), good: (w.reseviceRate ?? 1) <= 0.10 },
                      { label: 'Completion', value: pct(w.completionPct), good: (w.completionPct ?? 0) >= 0.95 },
                    ] : []),
                    { label: 'Driving', value: pct(w.drivingScore), good: (w.drivingScore ?? 0) >= 0.90 },
                    { label: 'Reliability', value: pct(w.reliabilityScore), good: (w.reliabilityScore ?? 0) >= 0.90 },
                  ].map(item => (
                    <div key={item.label} style={{ textAlign: 'center', padding: '7px 4px', background: item.good ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.10)', borderRadius: 8, border: `1px solid ${item.good ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.18)'}` }}>
                      <div style={{ fontSize: 10, color: '#7C7A73', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: item.good ? '#16a34a' : '#d97706' }}>{item.value}</div>
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
            <div style={{ background: '#FFFFFF', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(138,106,68,0.14)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#633806', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Monthly Average</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 100 }}>
                {MONTHS.map((m, i) => {
                  const s = monthly[i + 1];
                  const h = s ? Math.max((s / 1.1) * 100, 5) : 0;
                  return (
                    <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      {s && <div style={{ fontSize: 8, color: scoreColor(s), fontWeight: 700 }}>{(s*100).toFixed(0)}</div>}
                      <div style={{ width: '100%', height: `${h}%`, background: s ? scoreColor(s) : 'rgba(138,106,68,0.12)', borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                      <div style={{ fontSize: 8, color: '#A9A79E' }}>{m}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#7C7A73', textAlign: 'center' }}>
                YTD avg: <span style={{ fontWeight: 700, color: scoreColor(ytd) }}>{pct(ytd)}</span>
                <span style={{ color: '#A9A79E' }}> · Target: 90%</span>
              </div>
            </div>

            {/* Weekly trend */}
            <div style={{ background: '#FFFFFF', borderRadius: 20, padding: '16px 20px', border: '1px solid rgba(138,106,68,0.14)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#633806', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Last 8 Weeks</div>
              {weeks.slice(0, 8).reverse().map((w: any) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#7C7A73', width: 46, flexShrink: 0 }}>{fmtWeek(w.weekEnd)}</div>
                  <div style={{ flex: 1, height: 5, background: 'rgba(138,106,68,0.14)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min((w.totalScore || 0) / 1.1 * 100, 100)}%`, background: scoreColor(w.totalScore), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(w.totalScore), width: 46, textAlign: 'right', flexShrink: 0 }}>{pct(w.totalScore)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MY TEAM (team leaders only) */}
        {activeTab === 'team' && isTeamLeader && (
          <div>
            {!teamData ? (
              <div style={{ textAlign: 'center', padding: 40, color: T.muted, fontSize: 13 }}>Loading team…</div>
            ) : (teamData.members || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: T.muted, fontSize: 13 }}>No crew members found under your name.</div>
            ) : (
              <>
                {/* Week selector — leader can review any scored week */}
                {(teamData.availableWeeks || []).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: T.muted }}>Week</span>
                    <select value={teamData.selectedWeek || ''} onChange={e => setTeamWeek(e.target.value)}
                      style={{ flex: 1, fontSize: 13, padding: '8px 10px', borderRadius: 10, border: `1px solid ${T.line}`, background: T.card, color: T.ink }}>
                      {teamData.availableWeeks.map((w: string) => (
                        <option key={w} value={w}>Week of {fmtWeek(w)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Team average */}
                <div style={{ background: T.card, borderRadius: 20, padding: '20px', textAlign: 'center', border: `1px solid ${teamData.teamAvgWeekly ? scoreColor(teamData.teamAvgWeekly) + '33' : T.line}`, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Team average · {teamData.memberCount} members{teamData.latestWeekEnd ? ` · Week of ${fmtWeek(teamData.latestWeekEnd)}` : ''}</div>
                  <div style={{ fontSize: 48, fontWeight: 800, color: scoreColor(teamData.teamAvgWeekly), lineHeight: 1, letterSpacing: '-1.5px' }}>{pct(teamData.teamAvgWeekly)}</div>
                  {teamData.teamAvgYtd !== null && <div style={{ fontSize: 12, color: T.faint, marginTop: 6 }}>YTD {pct(teamData.teamAvgYtd)}</div>}
                </div>

                {/* Sub-view switch — team-specific: WP=TC Acct, PMP=PC Routes+Reservice, IP=none extra. All get Driving+Attendance. */}
                {(() => {
                  const lt = teamData.leader?.team;
                  const tabs: [string, string][] = [['roster', 'Team']];
                  if (lt === 'WP') tabs.push(['tc', 'TC Acct']);
                  if (lt === 'PMP') { tabs.push(['routes', 'PC Routes']); tabs.push(['reservice', 'Reservice']); }
                  tabs.push(['driving', 'Driving']);
                  tabs.push(['attendance', 'Attendance']);
                  return (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                      {tabs.map(([v, lbl]) => (
                        <button key={v} onClick={() => { setTeamView(v as any); setOpenMember(null); }}
                          style={{ flex: '1 0 auto', minWidth: 64, padding: '7px 8px', fontSize: 12, fontWeight: 500, borderRadius: 9, border: 'none', cursor: 'pointer',
                            background: teamView === v ? T.brown : 'rgba(138,106,68,0.10)', color: teamView === v ? '#fff' : T.brownText }}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* ROSTER — member cards, tap for breakdown */}
                {teamView === 'roster' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {teamData.members.map((m: any) => {
                      const l = m.latest;
                      const isOpen = openMember === m.techId;
                      return (
                        <div key={m.techId} style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.line}`, overflow: 'hidden' }}>
                          <button onClick={() => setOpenMember(isOpen ? null : m.techId)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.isLeader ? T.brown : 'rgba(138,106,68,0.14)', color: m.isLeader ? '#fff' : T.brownText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              {m.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{m.name}{m.isLeader && <span style={{ fontSize: 10, color: T.brownText, marginLeft: 6, fontWeight: 600 }}>YOU</span>}</div>
                              <div style={{ fontSize: 11, color: T.faint }}>{m.team} · {m.office}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 17, fontWeight: 700, color: scoreColor(l?.totalScore ?? null) }}>{pct(l?.totalScore ?? null)}</div>
                              <div style={{ fontSize: 10, color: T.faint }}>Weekly</div>
                            </div>
                          </button>
                          {isOpen && (
                            <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.line}` }}>
                              {!l ? (
                                <div style={{ fontSize: 12, color: T.muted, paddingTop: 12 }}>No scored week yet this period.</div>
                              ) : (
                                <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {[
                                    { label: 'Weekly score', value: pct(l.totalScore), good: (l.totalScore ?? 0) >= 0.90 },
                                    { label: 'Close-out %', value: pct(l.closeOutPct), good: (l.closeOutPct ?? 0) >= 0.85 },
                                    { label: 'Callback rate', value: pct(l.callbackRate), good: (l.callbackRate ?? 1) <= 0.15 },
                                    { label: 'Driving', value: pct(l.drivingScore), good: (l.drivingScore ?? 0) >= 0.90 },
                                    { label: 'Attendance', value: pct(l.reliabilityScore), good: (l.reliabilityScore ?? 0) >= 0.90 },
                                    { label: 'YTD avg', value: pct(m.ytd), good: (m.ytd ?? 0) >= 0.90 },
                                  ].map((row, i, arr) => (
                                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, paddingBottom: i < arr.length - 1 ? 8 : 0, borderBottom: i < arr.length - 1 ? `1px solid ${T.line}` : 'none' }}>
                                      <span style={{ color: T.muted }}>{row.label}</span>
                                      <span style={{ fontWeight: 600, color: row.good ? '#16a34a' : '#d97706' }}>{row.value}</span>
                                    </div>
                                  ))}
                                  {l.drivingOverride && <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 2 }}>⚠ Driving incident flagged this week</div>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* TC ACCT — pick Close Out % or Callback Rate, ranked best→worst */}
                {teamView === 'tc' && (() => {
                  const met = TC_METRICS[tcMetric];
                  const ranked = sortByMetric(teamData.members, met.key, met.lowerIsBetter);
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                        {TC_METRICS.map((mm, i) => (
                          <button key={mm.key} onClick={() => setTcMetric(i)}
                            style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 500, borderRadius: 8, border: `1px solid ${tcMetric === i ? T.brown : T.line}`, cursor: 'pointer', background: tcMetric === i ? 'rgba(138,106,68,0.12)' : '#fff', color: T.brownText }}>
                            {mm.label}
                          </button>
                        ))}
                      </div>
                      <RankedList ranked={ranked} met={met} T={T} />
                    </>
                  );
                })()}

                {/* DRIVING — Max Speed / Alerts per 1k / Idle Ratio, ranked best→worst */}
                {teamView === 'driving' && (() => {
                  const met = DRIVING_METRICS[drivingMetric];
                  const ranked = sortByMetric(teamData.members, met.key, met.lowerIsBetter);
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                        {DRIVING_METRICS.map((mm, i) => (
                          <button key={mm.key} onClick={() => setDrivingMetric(i)}
                            style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 500, borderRadius: 8, border: `1px solid ${drivingMetric === i ? T.brown : T.line}`, cursor: 'pointer', background: drivingMetric === i ? 'rgba(138,106,68,0.12)' : '#fff', color: T.brownText }}>
                            {mm.label}
                          </button>
                        ))}
                      </div>
                      <RankedList ranked={ranked} met={met} T={T} />
                    </>
                  );
                })()}

                {/* PC ROUTES (PMP) — Rev Eff / Completion / Production, ranked best→worst */}
                {teamView === 'routes' && (() => {
                  const met = ROUTES_METRICS[routesMetric];
                  const ranked = sortByMetric(teamData.members, met.key, met.lowerIsBetter);
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                        {ROUTES_METRICS.map((mm, i) => (
                          <button key={mm.key} onClick={() => setRoutesMetric(i)}
                            style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 500, borderRadius: 8, border: `1px solid ${routesMetric === i ? T.brown : T.line}`, cursor: 'pointer', background: routesMetric === i ? 'rgba(138,106,68,0.12)' : '#fff', color: T.brownText }}>
                            {mm.label}
                          </button>
                        ))}
                      </div>
                      <RankedList ranked={ranked} met={met} T={T} />
                    </>
                  );
                })()}

                {/* RESERVICE (PMP) — reservice rate, ranked best→worst (lower better) */}
                {teamView === 'reservice' && (() => {
                  const met = RESERVICE_METRICS[0];
                  const ranked = sortByMetric(teamData.members, met.key, met.lowerIsBetter);
                  return <RankedList ranked={ranked} met={met} T={T} />;
                })()}

                {/* ATTENDANCE — tap a member for their daily raw data */}
                {teamView === 'attendance' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {teamData.members.map((m: any) => {
                      const isOpen = openMember === m.techId;
                      return (
                        <div key={m.techId} style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.line}`, overflow: 'hidden' }}>
                          <button onClick={() => setOpenMember(isOpen ? null : m.techId)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.isLeader ? T.brown : 'rgba(138,106,68,0.14)', color: m.isLeader ? '#fff' : T.brownText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              {m.name.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{m.name}{m.isLeader && <span style={{ fontSize: 10, color: T.brownText, marginLeft: 6, fontWeight: 600 }}>YOU</span>}</div>
                              <div style={{ fontSize: 11, color: T.faint }}>Attendance · {pct(m.latest?.reliabilityScore ?? null)}</div>
                            </div>
                            <div style={{ fontSize: 12, color: T.faint }}>{isOpen ? '▲' : '▼'}</div>
                          </button>
                          {isOpen && (
                            <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.line}` }}>
                              {(!m.days || m.days.length === 0) ? (
                                <div style={{ fontSize: 12, color: T.muted, paddingTop: 12 }}>No daily attendance recorded for this week.</div>
                              ) : (
                                <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {m.days.map((d: any, i: number) => {
                                    const dt = new Date(d.date);
                                    const dow = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
                                    const md = dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
                                    const off = d.status && d.status !== 'WORKED';
                                    const late = (d.minutesLate ?? 0) > 0;
                                    const t = (v: any) => v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '—';
                                    return (
                                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingBottom: 6, borderBottom: i < m.days.length - 1 ? `1px solid ${T.line}` : 'none' }}>
                                        <div style={{ width: 58, flexShrink: 0, color: T.muted }}><span style={{ fontWeight: 600, color: T.ink }}>{dow}</span> {md}</div>
                                        {off ? (
                                          <div style={{ flex: 1, color: '#854F0B', fontWeight: 500 }}>{d.status === 'CALL_OUT' ? 'Called out' : 'Off'}</div>
                                        ) : (
                                          <>
                                            <div style={{ flex: 1, color: T.muted }}>{t(d.startTime)}–{t(d.finishTime)}{d.hrsWorked != null ? ` · ${d.hrsWorked.toFixed(1)}h` : ''}</div>
                                            <div style={{ flexShrink: 0, fontWeight: 600, color: late ? '#d97706' : '#16a34a' }}>{late ? `${Math.round(d.minutesLate)}m late` : 'On time'}</div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ fontSize: 11, color: T.faint, textAlign: 'center', marginTop: 14 }}>View only{teamData.latestWeekEnd ? ` · Week of ${fmtWeek(teamData.latestWeekEnd)}` : ''}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom safe area */}
      <div style={{ height: 'env(safe-area-inset-bottom, 20px)', background: T.bg }} />
    </div>
  );
}

// Ranked list for TC / Driving sub-views: members sorted best→worst on the chosen metric.
function RankedList({ ranked, met, T }: { ranked: any[]; met: any; T: any }) {
  if (ranked.length === 0) {
    return <div style={{ textAlign: 'center', padding: 24, color: T.muted, fontSize: 12 }}>No data for this metric this week.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ranked.map((m, i) => {
        const v = m.latest[met.key];
        const good = met.good(v);
        return (
          <div key={m.techId} style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
            <div style={{ width: 22, textAlign: 'center', fontSize: 13, fontWeight: 700, color: T.faint, flexShrink: 0 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{m.name}{m.isLeader && <span style={{ fontSize: 10, color: T.brownText, marginLeft: 6, fontWeight: 600 }}>YOU</span>}</div>
              <div style={{ fontSize: 11, color: T.faint }}>{m.team} · {m.office}</div>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: good ? '#16a34a' : '#d97706', flexShrink: 0 }}>{met.fmt(v)}</div>
          </div>
        );
      })}
    </div>
  );
}
