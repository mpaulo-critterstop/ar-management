'use client';
import { useEffect, useState } from 'react';
import { teamPill, statusPill, card, th, td } from './helpers';

interface Props { office: string; }

const EMPTY_FORM = {
  techId: '', name: '', team: 'WP', office: 'DFW',
  hrDays: 8, startTime: '7:00 AM', siteLeader: '', crewLeader: '',
  hireDate: '', notes: '',
};

export function RosterTab({ office }: Props) {
  const [techs, setTechs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'ALL') params.set('office', office);
    if (teamFilter) params.set('team', teamFilter);
    if (statusFilter) params.set('status', statusFilter);
    fetch(`/api/field-performance/roster?${params}`)
      .then(r => r.json())
      .then(d => { setTechs(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [office, teamFilter, statusFilter]);

  const filtered = techs.filter(t => {
    const q = search.toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.techId.toLowerCase().includes(q);
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (tech: any) => {
    setEditing(tech);
    setForm({
      techId: tech.techId,
      name: tech.name,
      team: tech.team,
      office: tech.office,
      hrDays: tech.hrDays,
      startTime: tech.startTime,
      siteLeader: tech.siteLeader ?? '',
      crewLeader: tech.crewLeader ?? '',
      hireDate: tech.hireDate ? tech.hireDate.split('T')[0] : '',
      notes: tech.notes ?? '',
    });
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      ...form,
      hrDays: Number(form.hrDays),
      hireDate: form.hireDate || null,
    };
    if (editing) {
      await fetch('/api/field-performance/roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...payload }),
      });
    } else {
      await fetch('/api/field-performance/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const deactivate = async (tech: any) => {
    if (!confirm(`Mark ${tech.name} as inactive?`)) return;
    await fetch('/api/field-performance/roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tech.id, status: 'INACTIVE', termDate: new Date().toISOString() }),
    });
    load();
  };

  const inputStyle: React.CSSProperties = { width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A' };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888780', marginBottom: 4, display: 'block' };

  if (showForm) {
    return (
      <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', minHeight: 540 }}>
        <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, width: '100%', maxWidth: 500, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#2C2C2A', marginBottom: 18 }}>
            {editing ? `Edit — ${editing.name}` : 'Add new technician'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Full name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="First Last" /></div>
            <div><label style={labelStyle}>Tech ID</label><input style={inputStyle} value={form.techId} onChange={e => setForm(f => ({ ...f, techId: e.target.value }))} placeholder="W-032" disabled={!!editing} /></div>
            <div>
              <label style={labelStyle}>Team</label>
              <select style={inputStyle} value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))}>
                <option value="WP">WP — Wildlife</option>
                <option value="PMP">PMP — Pest</option>
                <option value="IP">IP — Insulation</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Office</label>
              <select style={inputStyle} value={form.office} onChange={e => setForm(f => ({ ...f, office: e.target.value }))}>
                <option value="DFW">DFW</option>
                <option value="ATX">ATX</option>
                <option value="OKC">OKC</option>
                <option value="CStat">CStat</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Schedule</label>
              <select style={inputStyle} value={form.hrDays} onChange={e => setForm(f => ({ ...f, hrDays: Number(e.target.value) }))}>
                <option value={10}>10 hr days (4/10s)</option>
                <option value={8}>8 hr days (5/8s)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Start time</label>
              <select style={inputStyle} value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}>
                <option value="7:00 AM">7:00 AM</option>
                <option value="8:00 AM">8:00 AM</option>
              </select>
            </div>
            <div><label style={labelStyle}>Site leader</label><input style={inputStyle} value={form.siteLeader} onChange={e => setForm(f => ({ ...f, siteLeader: e.target.value }))} /></div>
            <div><label style={labelStyle}>Crew leader</label><input style={inputStyle} value={form.crewLeader} onChange={e => setForm(f => ({ ...f, crewLeader: e.target.value }))} /></div>
            <div><label style={labelStyle}>Hire date</label><input type="date" style={inputStyle} value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} /></div>
          </div>
          <div style={{ marginTop: 12 }}><label style={labelStyle}>Notes</label><input style={inputStyle} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, border: '1px solid #E8E7E3', background: '#F8F7F4', cursor: 'pointer', color: '#888780' }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.name || !form.techId} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: saving ? '#b0aea6' : '#0052cc', color: '#fff', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add technician'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="text" placeholder="Search name or Tech ID..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A' }}
        />
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{ fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A' }}>
          <option value="">All teams</option><option value="WP">WP</option><option value="PMP">PMP</option><option value="IP">IP</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: 12, padding: '6px 9px', border: '1px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A' }}>
          <option value="ACTIVE">Active only</option><option value="">All</option><option value="INACTIVE">Inactive</option>
        </select>
        <button onClick={openAdd} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '1px solid #E8E7E3', background: '#F8F7F4', cursor: 'pointer', color: '#2C2C2A', whiteSpace: 'nowrap' }}>
          + Add tech
        </button>
      </div>

      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 62 }}>Tech ID</th>
                <th style={{ ...th, width: 160 }}>Name</th>
                <th style={{ ...th, width: 46 }}>Team</th>
                <th style={{ ...th, width: 58 }}>Office</th>
                <th style={{ ...th, width: 65 }}>Schedule</th>
                <th style={{ ...th, width: 75 }}>Start time</th>
                <th style={{ ...th, width: 130 }}>Crew leader</th>
                <th style={{ ...th, width: 80 }}>Hire date</th>
                <th style={{ ...th, width: 68 }}>Status</th>
                <th style={{ ...th, width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 32 }}>No technicians found.</td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} style={{ opacity: t.status === 'INACTIVE' ? 0.5 : 1 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontSize: 11, color: '#888780' }}>{t.techId}</td>
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                  <td style={td}>{teamPill(t.team)}</td>
                  <td style={td}>{t.office}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.hrDays} hr</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.startTime}</td>
                  <td style={{ ...td, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.crewLeader ?? '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: '#888780' }}>{t.hireDate ? new Date(t.hireDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</td>
                  <td style={td}>{statusPill(t.status)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(t)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888780', fontSize: 14, padding: 0 }}>✎</button>
                      {t.status === 'ACTIVE' && (
                        <button onClick={() => deactivate(t)} title="Deactivate" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b0aea6', fontSize: 14, padding: 0 }}>×</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#b0aea6', marginTop: 8 }}>{filtered.length} technician{filtered.length !== 1 ? 's' : ''}</div>
    </div>
  );
}
