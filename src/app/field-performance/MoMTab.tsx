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
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/field-performance/mom?year=${year}&office=${office}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year, office]);

  const techs = data?.techs || [];
  const filtered = techs.filter((t: any) => {
    const q = search.toLowerCase();
    const nameMatch = t.name?.toLowerCase().includes(q);
    const idMatch = t.techId?.toLowerCase().includes(q);
    const teamMatch = !teamFilter || t.team === teamFilter;
    return (!search || nameMatch || idMatch) && teamMatch;
  });

  function scoreCell(score: number | null) {
    if (score === null || score === undefined) return <td style={{ ...td, textAlign: 'center', color: '#e2e8f0', fontSize: 11 }}>—</td>;
    const bg = score >= 0.90 ? '#EAF3DE' : score >= 0.75 ? '#FAEEDA' : '#FCEBEB';
    const color = score >= 0.90 ? '#27500A' : score >= 0.75 ? '#633806' : '#791F1F';
    return <td style={{ ...td, textAlign: 'center', background: bg, color, fontSize: 11, fontWeight: 500, padding: '6px 4px' }}>{(score * 100).toFixed(1) + '%'}</td>;
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0',
    borderRadius: 8, background: '#fff', color: '#0f172a'
  };

  return (
    <div>
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
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={inputStyle}>
          <option value={2026}>2026</option>
          <option value={2025}>2025</option>
        </select>
      </div>

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
              ) : filtered.map((t: any) => (
                <tr key={t.techId}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontSize: 11, color: '#64748b', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>{t.techId}</td>
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'sticky', left: 55, background: 'inherit', zIndex: 1 }}>{t.name}</td>
                  <td style={td}>{teamPill(t.team)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.office}</td>
                  {scoreCell(t.ytd)}
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(t.monthly[m]))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{filtered.length} technicians · {year} — calculated from weekly scores</div>
    </div>
  );
}
