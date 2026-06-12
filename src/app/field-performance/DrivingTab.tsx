'use client';
import { useEffect, useState } from 'react';
import { teamPill, scoreBadge, scoreBar, card, th, td } from './helpers';

interface Props { office: string; weekEnd: Date; }

function speedBadge(mph: number | null) {
  if (!mph) return <span style={{ color: '#b0aea6' }}>—</span>;
  const color = mph > 90 ? '#791F1F' : mph > 80 ? '#854F0B' : '#27500A';
  return <span style={{ color, fontSize: 12, fontWeight: mph > 80 ? 500 : 400 }}>{mph.toFixed(1)} mph</span>;
}

function alertsBadge(per1k: number | null) {
  if (per1k === null || per1k === undefined) return <span style={{ color: '#b0aea6' }}>—</span>;
  const color = per1k > 30 ? '#791F1F' : per1k > 15 ? '#854F0B' : '#27500A';
  return <span style={{ color, fontSize: 12, fontWeight: per1k > 30 ? 500 : 400 }}>{per1k.toFixed(1)}</span>;
}

function idleBadge(ratio: number | null) {
  if (ratio === null || ratio === undefined) return <span style={{ color: '#b0aea6' }}>—</span>;
  const pct = (ratio * 100).toFixed(1);
  const color = ratio > 0.40 ? '#791F1F' : ratio > 0.30 ? '#854F0B' : '#27500A';
  return <span style={{ color, fontSize: 12 }}>{pct}%</span>;
}

export function DrivingTab({ office, weekEnd }: Props) {
  const [weeks, setWeeks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [sort, setSort] = useState('score');

  useEffect(() => {
    setLoading(true);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/techweek?week=${wk}&office=${office !== 'ALL' ? office : ''}`)
      .then(r => r.json())
      .then(d => { setWeeks(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, weekEnd]);

  const withDriving = weeks.filter(w => w.drivingScore !== null);

  const filtered = withDriving
    .filter(w => {
      const q = search.toLowerCase();
      const nameMatch = w.technician?.name?.toLowerCase().includes(q);
      const idMatch = w.techId?.toLowerCase().includes(q);
      const teamMatch = !teamFilter || w.team === teamFilter;
      return (!search || nameMatch || idMatch) && teamMatch;
    })
    .sort((a, b) => {
      if (sort === 'score') return (b.drivingScore ?? -1) - (a.drivingScore ?? -1);
      if (sort === 'alerts') return (a.safetyAlertsPer1k ?? 999) - (b.safetyAlertsPer1k ?? 999);
      if (sort === 'speed') return (b.maxSpeed ?? 0) - (a.maxSpeed ?? 0);
      if (sort === 'idle') return (b.idleRatio ?? 0) - (a.idleRatio ?? 0);
      if (sort === 'name') return (a.technician?.name ?? '').localeCompare(b.technician?.name ?? '');
      return 0;
    });

  // Summary
  const avgScore = filtered.length > 0
    ? filtered.reduce((a, b) => a + (b.drivingScore ?? 0), 0) / filtered.length
    : null;
  const speedViolations = filtered.filter(w => (w.maxSpeed ?? 0) > 80).length;
  const highAlerts = filtered.filter(w => (w.safetyAlertsPer1k ?? 0) > 30).length;

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3',
    borderRadius: 8, background: '#fff', color: '#2C2C2A'
  };

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
        {[
          { label: 'Avg driving score', value: avgScore?.toFixed(2) ?? '—', color: avgScore !== null ? (avgScore >= 0.90 ? '#27500A' : avgScore >= 0.75 ? '#633806' : '#791F1F') : undefined },
          { label: 'Techs tracked', value: filtered.length },
          { label: 'Speed violations (>80mph)', value: speedViolations, color: speedViolations > 0 ? '#791F1F' : undefined },
          { label: 'High alerts (>30/1k mi)', value: highAlerts, color: highAlerts > 0 ? '#791F1F' : undefined },
        ].map(k => (
          <div key={k.label} style={{ background: '#F8F7F4', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888780', marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: k.color || '#2C2C2A' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input type="text" placeholder="Search name or Tech ID..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={inputStyle}>
          <option value="">All teams</option>
          <option value="WP">WP</option>
          <option value="PMP">PMP</option>
          <option value="IP">IP</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} style={inputStyle}>
          <option value="score">Sort: score</option>
          <option value="alerts">Sort: alerts</option>
          <option value="speed">Sort: max speed</option>
          <option value="idle">Sort: idle</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 55 }}>Tech ID</th>
                <th style={{ ...th, width: 150 }}>Name</th>
                <th style={{ ...th, width: 46 }}>Team</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 95 }}>Driving score</th>
                <th style={{ ...th, width: 85 }}>Max speed</th>
                <th style={{ ...th, width: 95 }}>Alerts / 1k mi</th>
                <th style={{ ...th, width: 75 }}>Idle ratio</th>
<th style={{ ...th, width: 80 }}>Speed penalty</th>
                <th style={{ ...th, width: 75 }}>Idle bonus</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>No driving data for this week yet.</td></tr>
              ) : filtered.map(w => {
                const speedPenalty = (w.maxSpeed ?? 0) > 90 ? 50 : (w.maxSpeed ?? 0) > 80 ? 8 : 0;
                const idleBonus = Math.max(0.08 - Math.max((w.idleRatio ?? 0) - 0.35, 0) * 0.50, 0);
                return (
                  <tr key={w.id}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                  >
                    <td style={{ ...td, fontSize: 11, color: '#888780' }}>{w.techId}</td>
                    <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.technician?.name}</td>
                    <td style={td}>{teamPill(w.team)}</td>
                    <td style={{ ...td, fontSize: 12 }}>{w.office}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {scoreBar(w.drivingScore, 52)}
                        {scoreBadge(w.drivingScore)}
                      </div>
                    </td>
                    <td style={td}>{speedBadge(w.maxSpeed)}</td>
                    <td style={td}>{alertsBadge(w.safetyAlertsPer1k)}</td>
                    <td style={td}>{idleBadge(w.idleRatio)}</td>
                    <td style={{ ...td, fontSize: 12, color: speedPenalty > 0 ? '#791F1F' : '#b0aea6' }}>
                      {speedPenalty > 0 ? `-${speedPenalty}` : '0'}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: idleBonus > 0 ? '#27500A' : '#b0aea6' }}>
                      {idleBonus > 0 ? `+${(idleBonus).toFixed(3)}` : '0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#b0aea6', marginTop: 8 }}>{filtered.length} techs with driving data</div>
    </div>
  );
}
