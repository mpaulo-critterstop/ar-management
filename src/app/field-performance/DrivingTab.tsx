'use client';
import { useEffect, useState } from 'react';
import { teamPill, scoreBadge, scoreBar, card, th, td, useSort, sortRows, SortableTh } from './helpers';

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

const inputStyle: React.CSSProperties = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff' };

export function DrivingTab({ office, weekEnd }: Props) {
  const [weeks, setWeeks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const sort = useSort('score', 'desc');

  // Override modal state
  const [overrideModal, setOverrideModal] = useState<any>(null);
  const [overrideNote, setOverrideNote] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/techweek?week=${wk}&office=${office !== 'ALL' ? office : ''}`)
      .then(r => r.json())
      .then(d => { setWeeks(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, weekEnd]);

  const filteredUnsorted = weeks
    .filter(w => !search || w.technician?.name?.toLowerCase().includes(search.toLowerCase()))
    .filter(w => !teamFilter || w.team === teamFilter);
  const filtered = sortRows(filteredUnsorted, sort, {
    techId: w => w.techId,
    name:   w => w.technician?.name ?? '',
    team:   w => w.team ?? '',
    office: w => w.office ?? '',
    score:  w => w.drivingScore,
    speed:  w => w.maxSpeed,
    alerts: w => w.safetyAlertsPer1k,
    idle:   w => w.idleRatio,
  });

  const withDriving = weeks.filter(w => w.drivingScore !== null);
  const avgScore = withDriving.length
    ? filtered.reduce((a, b) => a + (b.drivingScore ?? 0), 0) / filtered.length
    : null;
  const speedViolations = filtered.filter(w => (w.maxSpeed ?? 0) > 80).length;

  const handleOverrideSave = async () => {
    if (!overrideNote.trim()) return;
    setOverrideSaving(true);
    const res = await fetch('/api/field-performance/driving-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        techId: overrideModal.techId,
        weekEnd: weekEnd.toLocaleDateString('en-CA'),
        override: true,
        note: overrideNote,
      }),
    });
    if (res.ok) {
      setWeeks(prev => prev.map(w => w.techId === overrideModal.techId
        ? { ...w, drivingOverride: true, drivingOverrideNote: overrideNote }
        : w
      ));
    }
    setOverrideSaving(false);
    setOverrideModal(null);
    setOverrideNote('');
  };

  const handleOverrideRemove = async (w: any) => {
    await fetch('/api/field-performance/driving-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        techId: w.techId,
        weekEnd: weekEnd.toLocaleDateString('en-CA'),
        override: false,
        note: '',
      }),
    });
    setWeeks(prev => prev.map(wk => wk.techId === w.techId
      ? { ...wk, drivingOverride: false, drivingOverrideNote: null }
      : wk
    ));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {avgScore !== null && (
          <div style={{ ...card, padding: '12px 20px', minWidth: 140 }}>
            <div style={{ fontSize: 11, color: '#888780', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg driving score</div>
            <div style={{ fontSize: 26, fontWeight: 500 }}>{(avgScore * 100).toFixed(1)}%</div>
          </div>
        )}
        <div style={{ ...card, padding: '12px 20px', minWidth: 140 }}>
          <div style={{ fontSize: 11, color: '#888780', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Speed violations</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: speedViolations > 0 ? '#791F1F' : '#27500A' }}>{speedViolations}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input placeholder="Search tech..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
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
                <SortableTh sortKey="techId" sort={sort} style={{ width: 55 }}>Tech ID</SortableTh>
                <SortableTh sortKey="name" sort={sort} style={{ width: 150 }}>Name</SortableTh>
                <SortableTh sortKey="team" sort={sort} style={{ width: 46 }}>Team</SortableTh>
                <SortableTh sortKey="office" sort={sort} style={{ width: 55 }}>Office</SortableTh>
                <SortableTh sortKey="score" sort={sort} style={{ width: 110 }}>Driving score</SortableTh>
                <SortableTh sortKey="speed" sort={sort} style={{ width: 85 }}>Max speed</SortableTh>
                <SortableTh sortKey="alerts" sort={sort} style={{ width: 95 }}>Alerts / 1k mi</SortableTh>
                <SortableTh sortKey="idle" sort={sort} style={{ width: 75 }}>Idle ratio</SortableTh>
                <th style={{ ...th, width: 80 }}>Speed penalty</th>
                <th style={{ ...th, width: 75 }}>Idle bonus</th>
                <th style={{ ...th, width: 90 }}>Override</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>No driving data for this week yet.</td></tr>
              ) : filtered.map(w => {
                const speedPenalty = (w.maxSpeed ?? 0) > 90 ? 50 : (w.maxSpeed ?? 0) > 80 ? 8 : 0;
                const idleBonus = Math.max(0.08 - Math.max((w.idleRatio ?? 0) - 0.35, 0) * 0.50, 0);
                return (
                  <tr key={w.id}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = w.drivingOverride ? '#FEF3F2' : ''}
                    style={{ background: w.drivingOverride ? '#FEF3F2' : '' }}
                  >
                    <td style={{ ...td, fontSize: 11, color: '#888780' }}>{w.techId}</td>
                    <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.technician?.name}</td>
                    <td style={td}>{teamPill(w.team)}</td>
                    <td style={{ ...td, fontSize: 12 }}>{w.office}</td>
                    <td style={td}>
                      {w.drivingOverride ? (
                        <div>
                          <span style={{ fontSize: 11, color: '#791F1F', fontWeight: 500 }}>0% (override)</span>
                          <div style={{ fontSize: 10, color: '#888780', marginTop: 2, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.drivingOverrideNote}>{w.drivingOverrideNote}</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {scoreBar(w.drivingScore, 52)}
                          {scoreBadge(w.drivingScore)}
                        </div>
                      )}
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
                    <td style={td}>
                      {w.drivingOverride ? (
                        <button onClick={() => handleOverrideRemove(w)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#888780' }}>
                          Remove
                        </button>
                      ) : (
                        <button onClick={() => { setOverrideModal(w); setOverrideNote(''); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#791F1F' }}>
                          Set 0%
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#b0aea6', marginTop: 8 }}>{filtered.length} techs with driving data</div>

      {/* Override Modal */}
      {overrideModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 420, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>Override driving score</div>
            <div style={{ fontSize: 13, color: '#888780', marginBottom: 16 }}>{overrideModal.technician?.name} — driving score will be set to 0%</div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'block', marginBottom: 6 }}>Reason / note <span style={{ color: '#791F1F' }}>*</span></label>
              <textarea
                value={overrideNote}
                onChange={e => setOverrideNote(e.target.value)}
                placeholder="e.g. Vehicular incident on 6/9 — invoice #12345"
                rows={3}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setOverrideModal(null); setOverrideNote(''); }} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleOverrideSave} disabled={overrideSaving || !overrideNote.trim()} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', background: !overrideNote.trim() ? '#D3D1C7' : '#791F1F', color: '#fff', cursor: !overrideNote.trim() ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {overrideSaving ? 'Saving...' : 'Set driving to 0%'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
