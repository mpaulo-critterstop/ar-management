'use client';
import { useEffect, useState } from 'react';
import { scoreBadge, scoreBar, teamPill, card, th, td, initials, useSort, sortRows, SortableTh } from './helpers';

interface Props { office: string; weekEnd: Date; }

export function IndividualsTab({ office, weekEnd }: Props) {
  const [weeks, setWeeks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const sort = useSort('score', 'desc');
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/techweek?week=${wk}&office=${office === 'ALL' ? '' : office}`)
      .then(r => r.json())
      .then(d => { setWeeks(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, weekEnd]);

  const filteredUnsorted = weeks
    .filter(w => {
      const q = search.toLowerCase();
      const nameMatch = w.technician?.name?.toLowerCase().includes(q);
      const idMatch = w.techId?.toLowerCase().includes(q);
      const teamMatch = !teamFilter || w.team === teamFilter;
      return (!search || nameMatch || idMatch) && teamMatch;
    });
  const filtered = sortRows(filteredUnsorted, sort, {
    techId:     w => w.techId,
    name:       w => w.technician?.name ?? '',
    team:       w => w.team ?? '',
    office:     w => w.office ?? '',
    score:      w => w.totalScore,
    co:         w => w.closeOutPct,
    cb:         w => w.callbackRate,
    revEff:     w => w.revenueEfficiency,
    reservice:  w => w.reseviceRate,
    completion: w => w.completionPct,
    driving:    w => w.drivingScore,
    reliability:w => w.reliabilityScore,
  });

  const inputStyle: React.CSSProperties = { fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A' };

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {/* Main table */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input
            type="text" placeholder="Search name or Tech ID..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={inputStyle}>
            <option value="">All teams</option>
            <option value="WP">WP</option>
            <option value="PMP">PMP</option>
            <option value="IP">IP</option>
          </select>
        </div>

        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 30 }}>#</th>
                  <SortableTh sortKey="techId" sort={sort} style={{ width: 58 }}>ID</SortableTh>
                  <SortableTh sortKey="name" sort={sort} style={{ width: selected ? 120 : 150 }}>Name</SortableTh>
                  <SortableTh sortKey="team" sort={sort} style={{ width: 46 }}>Team</SortableTh>
                  <SortableTh sortKey="office" sort={sort} style={{ width: 52 }}>Office</SortableTh>
                  <SortableTh sortKey="score" sort={sort} style={{ width: 95 }}>Score</SortableTh>
                  {!selected && <SortableTh sortKey="co" sort={sort} style={{ width: 52 }}>CO%</SortableTh>}
                  {!selected && <SortableTh sortKey="cb" sort={sort} style={{ width: 58 }}>CB Rate</SortableTh>}
                  {!selected && <SortableTh sortKey="revEff" sort={sort} style={{ width: 60 }}>Rev Eff</SortableTh>}
                  {!selected && <SortableTh sortKey="reservice" sort={sort} style={{ width: 58 }}>Reservice</SortableTh>}
                  {!selected && <SortableTh sortKey="completion" sort={sort} style={{ width: 62 }}>Completion</SortableTh>}
                  {!selected && <SortableTh sortKey="driving" sort={sort} style={{ width: 60 }}>Driving</SortableTh>}
                  {!selected && <SortableTh sortKey="reliability" sort={sort} style={{ width: 68 }}>Reliability</SortableTh>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>No scores recorded for this week yet.</td></tr>
                ) : filtered.map((w, i) => (
                  <tr key={w.id}
                    onClick={() => setSelected(selected?.id === w.id ? null : w)}
                    style={{ cursor: 'pointer', background: selected?.id === w.id ? '#f0f7ff' : '' }}
                    onMouseEnter={e => { if (selected?.id !== w.id) (e.currentTarget as HTMLElement).style.background = '#F8F7F4'; }}
                    onMouseLeave={e => { if (selected?.id !== w.id) (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td style={{ ...td, color: '#b0aea6', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ ...td, fontSize: 11, color: '#888780' }}>{w.techId}</td>
                    <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.technician?.name ?? '—'}</td>
                    <td style={td}>{teamPill(w.team)}</td>
                    <td style={{ ...td, fontSize: 12 }}>{w.office}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {scoreBar(w.totalScore, 52)}
                        {scoreBadge(w.totalScore)}
                      </div>
                    </td>
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.closeOutPct != null && !isNaN(w.closeOutPct) ? (w.closeOutPct * 100).toFixed(0) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.callbackRate != null && !isNaN(w.callbackRate) ? (w.callbackRate * 100).toFixed(0) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.revenueEfficiency !== null ? (w.revenueEfficiency * 100).toFixed(0) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.reseviceRate !== null && w.reseviceRate > 0 ? (w.reseviceRate * 100).toFixed(1) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.completionPct !== null ? (w.completionPct * 100).toFixed(0) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.drivingOverride ? <span style={{color:'#791F1F',fontWeight:500}}>0% ⚠</span> : w.drivingScore !== null ? (w.drivingScore * 100).toFixed(0) + '%' : '—'}</td>}
                    {!selected && <td style={{ ...td, fontSize: 12 }}>{w.reliabilityScore !== null ? (w.reliabilityScore * 100).toFixed(0) + '%' : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#E6F0FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: '#0C447C', flexShrink: 0 }}>
                {initials(selected.technician?.name ?? '?')}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#2C2C2A', lineHeight: 1.3 }}>{selected.technician?.name}</div>
                <div style={{ fontSize: 11, color: '#888780' }}>{selected.techId} · {teamPill(selected.team)}</div>
              </div>
            </div>

            <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#b0aea6', fontSize: 16 }}>✕</button>

            <div style={{ fontSize: 11, fontWeight: 500, color: '#888780', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>This week</div>
            <div style={{ fontSize: 30, fontWeight: 500, marginBottom: 12, color: '#2C2C2A' }}>
              {selected.totalScore ? (selected.totalScore * 100).toFixed(1) + '%' : '—'}
            </div>

            {[
              { label: 'Close-out %', val: selected.closeOutPct !== null ? (selected.closeOutPct * 100).toFixed(0) + '%' : '—' },
              { label: 'Callback rate', val: selected.callbackRate !== null ? (selected.callbackRate * 100).toFixed(0) + '%' : '—' },
              { label: 'Rev. efficiency', val: selected.revenueEfficiency !== null ? (selected.revenueEfficiency * 100).toFixed(0) + '%' : '—' },
              { label: 'Reservice rate', val: selected.reseviceRate !== null ? (selected.reseviceRate * 100).toFixed(0) + '%' : '—' },
              { label: 'Completion %', val: selected.completionPct !== null ? (selected.completionPct * 100).toFixed(0) + '%' : '—' },
              { label: 'Driving', val: selected.drivingOverride ? '0% (override)' : selected.drivingScore !== null ? (selected.drivingScore * 100).toFixed(0) + '%' : '—' },
              { label: 'Reliability', val: selected.reliabilityScore !== null ? (selected.reliabilityScore * 100).toFixed(0) + '%' : '—' },
              { label: 'Reviews (30d)', val: selected.reviewCount ?? '—' },
              { label: 'Manual adj.', val: selected.manualAdj !== null && selected.manualAdj !== 0 ? (selected.manualAdj > 0 ? '+' : '') + selected.manualAdj?.toFixed(2) : '—' },
              { label: 'Office', val: selected.office },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '0.5px solid #F1EFE8' }}>
                <span style={{ fontSize: 12, color: '#888780' }}>{row.label}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
