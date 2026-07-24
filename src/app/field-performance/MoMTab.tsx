'use client';
import { useEffect, useState } from 'react';
import { teamPill, scoreBadge, card, th, td } from './helpers';

interface Props { office: string; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function MoMTab({ office }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);
  const [teamFilter, setTeamFilter] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState('totalScore');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/field-performance/mom?year=${year}&office=${office}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year, office]);

  const techs = data?.techs || [];
  const metricDefs = data?.metrics || [];
  const teamAverages = data?.teamAverages || {};
  const activeMetric = metricDefs.find((m: any) => m.key === metric) || metricDefs[0];
  const higher = activeMetric?.higher ?? true;
  const standard = activeMetric?.standard ?? 0.9;

  // Crew leaders present in the data (excluding self-assignments), for the dropdown.
  const leaders = [...new Set(techs.filter((t: any) => t.crewLeader && t.crewLeader !== t.name).map((t: any) => t.crewLeader) as string[])].sort((a, b) => a.localeCompare(b));

  const mData = (t: any) => t.metrics?.[metric] ?? { ytd: null, monthly: {} };

  const filtered = techs.filter((t: any) => {
    const q = search.toLowerCase();
    const nameMatch = t.name?.toLowerCase().includes(q);
    const idMatch = t.techId?.toLowerCase().includes(q);
    const teamMatch = !teamFilter || t.team === teamFilter;
    const leaderMatch = !leaderFilter || t.crewLeader === leaderFilter;
    const statusMatch = statusFilter === 'ALL'
      || (statusFilter === 'ACTIVE' && t.status === 'ACTIVE')
      || (statusFilter === 'INACTIVE' && t.status !== 'ACTIVE');
    return (!search || nameMatch || idMatch) && teamMatch && leaderMatch && statusMatch;
  }).sort((a: any, b: any) => {
    // Sort by the selected metric's YTD, best-first (direction depends on higher-is-better).
    const av = mData(a).ytd, bv = mData(b).ytd;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return higher ? bv - av : av - bv;
  });

  // Color a cell relative to the metric's standard and direction (lower-is-better flips it).
  function scoreCell(val: number | null, key?: string | number) {
    if (val === null || val === undefined) return <td key={key} style={{ ...td, textAlign: 'center', color: '#e2e8f0', fontSize: 11 }}>—</td>;
    const meetsStd = higher ? val >= standard : val <= standard;
    const near = higher ? val >= standard * 0.85 : val <= standard * 1.30;
    const bg = meetsStd ? '#EAF3DE' : near ? '#FAEEDA' : '#FCEBEB';
    const color = meetsStd ? '#27500A' : near ? '#633806' : '#791F1F';
    return <td key={key} style={{ ...td, textAlign: 'center', background: bg, color, fontSize: 11, fontWeight: 500, padding: '6px 4px' }}>{(val * 100).toFixed(1) + '%'}</td>;
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0',
    borderRadius: 8, background: '#fff', color: '#0f172a'
  };

  const teamAvg = teamAverages[metric] ?? { ytd: null, monthly: {} };

  // Crew-leader rollup: group the filtered techs by crewLeader; each month value is the
  // average of that crew's techs for that month (matches the FPEM MoM summary section).
  const leaderRollup = (() => {
    const groups = new Map<string, any[]>();
    for (const t of filtered) {
      const cl = t.crewLeader || '—';
      if (!groups.has(cl)) groups.set(cl, []);
      groups.get(cl)!.push(t);
    }
    const avg = (nums: number[]) => nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    const rows = [...groups.entries()].map(([leader, members]) => {
      const monthly: Record<number, number | null> = {};
      for (let m = 1; m <= 12; m++) {
        const vals = members.map(t => mData(t).monthly?.[m]).filter((v: any) => v !== null && v !== undefined) as number[];
        monthly[m] = avg(vals);
      }
      const ytdVals = members.map(t => mData(t).ytd).filter((v: any) => v !== null && v !== undefined) as number[];
      const offices = [...new Set(members.map(t => t.office))];
      return { leader, memberCount: members.length, office: offices.length === 1 ? offices[0] : 'Multi', ytd: avg(ytdVals), monthly };
    });
    // Sort best-first by YTD (respecting metric direction).
    rows.sort((a, b) => {
      if (a.ytd === null) return 1;
      if (b.ytd === null) return -1;
      return higher ? b.ytd - a.ytd : a.ytd - b.ytd;
    });
    return rows;
  })();

  return (
    <div>
      {/* Metric selector — the 8 MoM tables from the FPEM sheet */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {metricDefs.map((m: any) => (
          <button key={m.key} onClick={() => setMetric(m.key)}
            style={{
              fontSize: 12, padding: '6px 11px', borderRadius: 8, cursor: 'pointer',
              border: metric === m.key ? '1px solid #0052cc' : '0.5px solid #D3D1C7',
              background: metric === m.key ? '#EAF1FC' : '#fff',
              color: metric === m.key ? '#0052cc' : '#64748b',
              fontWeight: metric === m.key ? 600 : 400,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input type="text" placeholder="Search name or Tech ID..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={inputStyle}>
          <option value="">All teams</option>
          <option value="WP">WP</option>
          <option value="PMP">PMP</option>
          <option value="IP">IP</option>
        </select>
        {leaders.length > 0 && (
          <select value={leaderFilter} onChange={e => setLeaderFilter(e.target.value)} style={{ ...inputStyle, background: leaderFilter ? '#EAF1FC' : '#fff' }}>
            <option value="">All team leaders</option>
            {leaders.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} style={inputStyle}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALL">All</option>
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={inputStyle}>
          <option value={2026}>2026</option>
          <option value={2025}>2025</option>
        </select>
      </div>

      {/* ── Crew Leader summary table ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', margin: '4px 0 8px' }}>Summary by Crew Leader</div>
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 180, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Crew Leader</th>
                <th style={{ ...th, width: 55 }}>Techs</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 65, background: '#f0f7ff', color: '#0052cc' }}>YTD</th>
                {MONTHS.map(m => <th key={m} style={{ ...th, width: 52, textAlign: 'center' }}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : leaderRollup.length === 0 ? (
                <tr><td colSpan={16} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No data available.</td></tr>
              ) : (
                <>
                  <tr style={{ background: '#F8F7F4' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#F8F7F4', zIndex: 1, fontWeight: 600, fontSize: 12 }}>
                      Total Team <span style={{ color: '#888780', fontWeight: 400 }}>· Std {(standard * 100).toFixed(0)}%</span>
                    </td>
                    <td style={td}></td>
                    <td style={td}></td>
                    {scoreCell(teamAvg.ytd, 'ytd')}
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(teamAvg.monthly?.[m], m))}
                  </tr>
                  {leaderRollup.map(row => (
                    <tr key={row.leader}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                    >
                      <td style={{ ...td, fontWeight: 500, position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>{row.leader}</td>
                      <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{row.memberCount}</td>
                      <td style={{ ...td, fontSize: 12 }}>{row.office}</td>
                      {scoreCell(row.ytd, 'ytd')}
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(row.monthly?.[m], m))}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Individual technician table ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', margin: '18px 0 8px' }}>By Technician</div>
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                  <th style={{ ...th, width: 55, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Tech ID</th>
                  <th style={{ ...th, width: 150, position: 'sticky', left: 55, background: '#f8fafc', zIndex: 1 }}>Name</th>
                  <th style={{ ...th, width: 46 }}>Team</th>
                  <th style={{ ...th, width: 55 }}>Office</th>
                  <th style={{ ...th, width: 65, background: '#f0f7ff', color: '#0052cc' }}>YTD</th>
                  {MONTHS.map(m => <th key={m} style={{ ...th, width: 52, textAlign: 'center' }}>{m}</th>)}
                </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={17} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={17} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No data available.</td></tr>
              ) : (
                <>
                  {/* Standard + Team-average summary row */}
                  <tr style={{ background: '#F8F7F4' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#F8F7F4', zIndex: 1, fontSize: 11, color: '#888780' }}>—</td>
                    <td style={{ ...td, position: 'sticky', left: 55, background: '#F8F7F4', zIndex: 1, fontWeight: 600, fontSize: 12 }}>
                      Total Team <span style={{ color: '#888780', fontWeight: 400 }}>· Std {(standard * 100).toFixed(0)}%</span>
                    </td>
                    <td style={td}></td>
                    <td style={td}></td>
                    {scoreCell(teamAvg.ytd, 'ytd')}
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(teamAvg.monthly?.[m], m))}
                  </tr>
                  {filtered.map((t: any) => {
                    const md = mData(t);
                    return (
                      <tr key={t.techId}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                      >
                        <td style={{ ...td, fontSize: 11, color: '#64748b', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>{t.techId}</td>
                        <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'sticky', left: 55, background: 'inherit', zIndex: 1 }}>{t.name}</td>
                        <td style={td}>{teamPill(t.team)}</td>
                        <td style={{ ...td, fontSize: 12 }}>{t.office}</td>
                        {scoreCell(md.ytd, 'ytd')}
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(md.monthly?.[m], m))}
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
        {filtered.length} technicians · {activeMetric?.label} · {year} — crew-leader values are averages of each crew's techs; monthly values are averages of that month's weekly scores
      </div>
    </div>
  );
}
