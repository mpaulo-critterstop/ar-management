'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
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
  if (mins === null || mins === undefined) return <span style={{ color: '#b0aea6' }}>—</span>;
  if (mins <= 0) return <span style={{ color: '#27500A', fontSize: 12 }}>{Math.abs(mins).toFixed(0)}m early</span>;
  if (mins <= 10) return <span style={{ color: '#888780', fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
  if (mins <= 20) return <span style={{ color: '#854F0B', fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
  return <span style={{ color: '#791F1F', fontWeight: 500, fontSize: 12 }}>{mins.toFixed(0)}m late</span>;
}

export function AttendanceTab({ office, weekEnd }: Props) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ routeStartTime: '', scheduledHrs: 8, startTime: '', finishTime: '' });
  const [saving, setSaving] = useState(false);
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canEdit = ['ADMIN', 'LEADERSHIP'].includes(role);

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

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const body: any = {
      id: editing.id,
      routeStartTime: editForm.routeStartTime,
      scheduledHrs: editForm.scheduledHrs,
    };
    // Only send startTime/finishTime if they were changed
    if (editForm.startTime) body.startTime = toUTCFromChicago(editing.date, editForm.startTime);
    if (editForm.finishTime) body.finishTime = toUTCFromChicago(editing.date, editForm.finishTime);
    await fetch('/api/field-performance/attendance-update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setEditing(null);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/attendance?week=${wk}&office=${office}`)
      .then(r => r.json())
      .then(d => setRecords(Array.isArray(d) ? d : []));
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setEditForm({
      routeStartTime: r.routeStartTime || '7:00 AM',
      scheduledHrs: r.scheduledHrs || 8,
      startTime: r.startTime ? toChicagoTimeInput(r.startTime) : '',
      finishTime: r.finishTime ? toChicagoTimeInput(r.finishTime) : '',
    });
  };

  // Convert a UTC datetime string to Chicago local time HH:MM for input[type=time]
  function toChicagoTimeInput(dt: string): string {
    const d = new Date(dt);
    const local = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' });
    return local; // returns "HH:MM"
  }

  // Convert a date string + HH:MM local time to UTC ISO string
  function toUTCFromChicago(dateStr: string, timeStr: string): string {
    const dateOnly = new Date(dateStr).toLocaleDateString('en-CA', { timeZone: 'UTC' });
    const localStr = `${dateOnly}T${timeStr}:00`;
    // Treat as Chicago time
    const d = new Date(new Date(localStr).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    // Create UTC from Chicago offset
    const offset = -5 * 60; // CST offset in minutes (simplified; use -6 for CDT)
    const utc = new Date(new Date(localStr).getTime() - offset * 60000);
    // Better: just use Intl to get Chicago offset dynamically
    const chicagoDate = new Date(localStr);
    const chicagoOffset = new Date(chicagoDate.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getTime() - chicagoDate.getTime();
    return new Date(chicagoDate.getTime() - chicagoOffset).toISOString();
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3',
    borderRadius: 8, background: '#fff', color: '#2C2C2A'
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
          <div key={k.label} style={{ background: '#F8F7F4', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#888780', marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: (k as any).color || '#2C2C2A' }}>{k.value}</div>
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
                {canEdit && <th style={{ ...th, width: 36 }}></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>No attendance data for this week yet.</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontSize: 11, color: '#888780' }}>{r.techId}</td>
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
                  {canEdit && (
                    <td style={td}>
                      <button onClick={() => openEdit(r)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.manualOverride ? '#0052cc' : '#888780', fontSize: 14, padding: 0 }}
                        title={r.manualOverride ? 'Manually overridden' : 'Edit'}>
                        {r.manualOverride ? '✎*' : '✎'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#b0aea6', marginTop: 8 }}>{filtered.length} day records</div>

      {/* Edit Modal */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 24, width: 340 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Edit Attendance</div>
            <div style={{ fontSize: 12, color: '#888780', marginBottom: 16 }}>
              {editing.technician?.name} — {fmtDate(editing.date)}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#888780', display: 'block', marginBottom: 4 }}>Scheduled start time</label>
              <select value={editForm.routeStartTime}
                onChange={e => setEditForm(f => ({ ...f, routeStartTime: e.target.value }))}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #E8E7E3', borderRadius: 8 }}>
                <option value="6:00 AM">6:00 AM</option>
                <option value="7:00 AM">7:00 AM</option>
                <option value="8:00 AM">8:00 AM</option>
                <option value="9:00 AM">9:00 AM</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#888780', display: 'block', marginBottom: 4 }}>Scheduled hours</label>
              <select value={editForm.scheduledHrs} onChange={e => setEditForm(f => ({ ...f, scheduledHrs: Number(e.target.value) }))}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #E8E7E3', borderRadius: 8 }}>
                <option value={8}>8 hrs</option>
                <option value={10}>10 hrs</option>
              </select>
            </div>
            <div style={{ fontSize: 11, color: '#b0aea6', marginBottom: 16 }}>
              Actual arrival: {fmtTime(editing.startTime)} — changing scheduled start will recalculate minutes late and reliability score.
              {editing.manualOverride && <span style={{ color: '#0052cc', marginLeft: 6 }}>⚡ Manually overridden — will not be overwritten by syncs.</span>}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#888780', display: 'block', marginBottom: 4 }}>Actual start time <span style={{ color: '#b0aea6' }}>(override)</span></label>
              <input type="time" value={editForm.startTime}
                onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #E8E7E3', borderRadius: 8 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#888780', display: 'block', marginBottom: 4 }}>Actual finish time <span style={{ color: '#b0aea6' }}>(override)</span></label>
              <input type="time" value={editForm.finishTime}
                onChange={e => setEditForm(f => ({ ...f, finishTime: e.target.value }))}
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #E8E7E3', borderRadius: 8 }} />
            </div>
            <div style={{ fontSize: 11, color: '#b0aea6', marginBottom: 16 }}>
              Setting start/finish time will mark this record as manually overridden and protect it from future syncs.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)}
                style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, border: '1px solid #E8E7E3', background: '#F8F7F4', cursor: 'pointer', color: '#888780' }}>
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                style={{ padding: '7px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: saving ? '#b0aea6' : '#0052cc', color: '#fff', cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
