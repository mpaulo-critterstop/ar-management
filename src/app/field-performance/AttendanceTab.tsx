'use client';
import { useEffect, useState } from 'react';
import { teamPill, card, th, td } from './helpers';

interface Props { office: string; weekEnd: Date; }

const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtTime(dt: string | null) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
}

function fmtDate(dt: string) {
  // Parse as noon UTC to avoid timezone day-shift issues
  const d = new Date(dt);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const date = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  return `${day} ${date}`;
}

function lateBadge(mins: number | null) {
  if (mins === null || mins === undefined) return <span style={{ color: '#94a3b8' }}>—</span>;
  if (mins <= 0) return <span style={{ color: '#27500A', fontSize: 12 }}>{Math.abs(mins).toFixed(0)}m early</span>;
  if (mins <= 10) return <span style={{ color: '#64748b', fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
  if (mins <= 20) return <span style={{ color: '#854F0B', fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
  return <span style={{ color: '#791F1F', fontWeight: 500, fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
}

export function AttendanceTab({ office, weekEnd }: Props) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/attendance?week=${wk}&office=${office}`)
      .then(r => r.json())
      .then(d => { setRecords(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, weekEnd]);

  const filtered = records.filter(r => {
    const q = search.toLowerCase();
    const nameMatch = r.technician?.name?.toLowerCase().includes(q);
    const idMatch = r.techId?.toLowerCase().includes(q);
    const teamMatch = !teamFilter || r.team === teamFilter;
    return (!search || nameMatch || idMatch) && teamMatch;
  });

  // Summary stats
  const worked = filtered.filter(r => r.status === 'WORKED');
  const avgLate = worked.length > 0
    ? worked.reduce((a, b) => a + (b.minutesLate ?? 0), 0) / worked.length
    : null;
  const onTime = worked.filter(r => (r.minutesLate ?? 0) <= 10).length;

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0',
    borderRadius: 8, background: '#fff', color: '#0f172a'
  };

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
        {[
          { label: 'Days recorded', value: worked.length },
          { label: 'Avg mins late', value: avgLate !== null ? avgLate.toFixed(1) : '—', color: avgLate !== null && avgLate > 20 ? '#791F1F' : avgLate !== null && avgLate > 0 ? '#633806' : '#27500A' },
          { label: 'On time / early', value: `${onTime}/${worked.length}` },
          { label: 'Late (>10 min)', value: worked.filter(r => (r.minutesLate ?? 0) > 10).length },
        ].map(k => (
          <div key={k.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: (k as any).color || '#0f172a' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input type="text" placeholder="Search name or Tech ID..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1 }} />
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
                <th style={{ ...th, width: 55 }}>Tech ID</th>
                <th style={{ ...th, width: 150 }}>Name</th>
                <th style={{ ...th, width: 46 }}>Team</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 90 }}>Date</th>
                <th style={{ ...th, width: 70 }}>Sched. start</th>
                <th style={{ ...th, width: 80 }}>Start time</th>
                <th style={{ ...th, width: 80 }}>Finish time</th>
                <th style={{ ...th, width: 90 }}>Punctuality</th>
                <th style={{ ...th, width: 80 }}>Hrs worked</th>
                <th style={{ ...th, width: 60 }}>Sched. hrs</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No attendance data for this week yet.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{r.techId}</td>
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.technician?.name}</td>
                  <td style={td}>{teamPill(r.team)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.office}</td>
                  <td style={{ ...td, fontSize: 12 }}>{fmtDate(r.date)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.routeStartTime || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{fmtTime(r.startTime)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{fmtTime(r.finishTime)}</td>
                  <td style={td}>{lateBadge(r.minutesLate)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.hrsWorked ? r.hrsWorked.toFixed(1) + ' hrs' : '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{r.scheduledHrs} hrs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{filtered.length} day records</div>
    </div>
  );
}
