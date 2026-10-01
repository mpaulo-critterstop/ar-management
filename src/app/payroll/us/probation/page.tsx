'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const fmtDate = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '';
function daysUntil(d: any): number | null { if (!d) return null; return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }
// Auto-fill probation end = hire + 90 days.
function plus90(hire: string): string { if (!hire) return ''; const d = new Date(hire + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 90); return d.toISOString().slice(0, 10); }

export default function ProbationTrackerPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'inactive'>('active');
  const [statusF, setStatusF] = useState('');

  const load = () => fetch('/api/payroll/probation').then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.employeeName) { alert('Name is required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/probation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing.id ? 'update' : 'add', ...editing }) });
    setSaving(false); setEditing(null); load();
  }
  async function setActive(row: any, active: boolean) {
    if (!confirm(`${active ? 'Reactivate' : 'Deactivate'} ${row.employeeName}?`)) return;
    await fetch('/api/payroll/probation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', ...row, hireDate: fmtDate(row.hireDate), probationEndDate: fmtDate(row.probationEndDate), addedToOnPayDate: fmtDate(row.addedToOnPayDate), active }) });
    load();
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', position: 'sticky', top: 0, background: '#fff', zIndex: 2, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 };

  const filtered = rows
    .filter(r => view === 'inactive' ? r.active === false : r.active !== false)
    .filter(r => !statusF || r.status === statusF)
    .filter(r => !search || (r.employeeName + ' ' + (r.techId || '')).toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll/us" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← US Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Probation Tracker</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 18px' }}>New hires and their probation status. Days until eligible is computed from the probation end date (hire + 90 days by default).</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', position: 'sticky', top: 0, background: '#fff', zIndex: 3, padding: '8px 0' }}>
        <button onClick={() => setEditing({ active: true, status: 'In probation' })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>+ Add employee</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or Tech ID…" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', flex: 1, minWidth: 180 }} />
        <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, border: '0.5px solid #E8E7E3' }}>
          <option value="">All statuses</option><option value="In probation">In probation</option><option value="Done - added">Done - added</option>
        </select>
        <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3 }}>
          {(['active', 'inactive'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: view === v ? '#fff' : 'transparent', color: view === v ? '#2C2C2A' : '#888780', fontWeight: view === v ? 600 : 400, textTransform: 'capitalize' }}>{v}</button>
          ))}
        </div>
      </div>

      {editing && (
        <div style={{ border: '0.5px solid #534AB7', borderRadius: 12, padding: 16, background: '#F7F6FD', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing.id ? 'Edit' : 'Add'} employee</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#888780' }}>Name *<input value={editing.employeeName || ''} onChange={e => setEditing({ ...editing, employeeName: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Tech ID<input value={editing.techId || ''} onChange={e => setEditing({ ...editing, techId: e.target.value })} placeholder="I-035" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Hire date<input type="date" value={fmtDate(editing.hireDate)} onChange={e => setEditing({ ...editing, hireDate: e.target.value, probationEndDate: editing.probationEndDate || plus90(e.target.value) })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Probation end<input type="date" value={fmtDate(editing.probationEndDate)} onChange={e => setEditing({ ...editing, probationEndDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Status<select value={editing.status || 'In probation'} onChange={e => setEditing({ ...editing, status: e.target.value })} style={inp}><option value="In probation">In probation</option><option value="Done - added">Done - added</option></select></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Added to OnPay date<input type="date" value={fmtDate(editing.addedToOnPayDate)} onChange={e => setEditing({ ...editing, addedToOnPayDate: e.target.value, addedToOnPay: !!e.target.value })} style={inp} /></label>
          </div>
          <div style={{ marginTop: 10 }}><label style={{ fontSize: 12, color: '#888780', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!editing.addedToOnPay} onChange={e => setEditing({ ...editing, addedToOnPay: e.target.checked })} /> Added to OnPay</label></div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontWeight: 500, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', maxHeight: '62vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Tech ID</th><th style={th}>Hire</th><th style={th}>Probation End</th>
            <th style={{ ...th, textAlign: 'right' }}>Days Until Eligible</th><th style={th}>Status</th><th style={th}>OnPay</th><th style={{ ...th, textAlign: 'right' }}></th>
          </tr></thead>
          <tbody>
            {filtered.map(r => {
              const du = daysUntil(r.probationEndDate);
              const eligible = du != null && du <= 0;
              return (
                <tr key={r.id} style={{ opacity: r.active === false ? 0.5 : 1 }}>
                  <td style={td}>{r.employeeName}</td>
                  <td style={td}>{r.techId || '—'}</td>
                  <td style={td}>{fmtDate(r.hireDate) || '—'}</td>
                  <td style={td}>{fmtDate(r.probationEndDate) || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: eligible ? '#128a3f' : '#2C2C2A' }}>{du != null ? (eligible ? `Eligible (${-du}d ago)` : du) : '—'}</td>
                  <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: r.status === 'Done - added' ? '#E1F5EE' : '#FBF3E5', color: r.status === 'Done - added' ? '#0F6E56' : '#BA7517' }}>{r.status || 'In probation'}</span></td>
                  <td style={td}>{r.addedToOnPay ? '✓' : '—'}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing({ ...r, hireDate: fmtDate(r.hireDate), probationEndDate: fmtDate(r.probationEndDate), addedToOnPayDate: fmtDate(r.addedToOnPayDate) })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#534AB7', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                    {r.active === false
                      ? <button onClick={() => setActive(r, true)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#128a3f', cursor: 'pointer' }}>Reactivate</button>
                      : <button onClick={() => setActive(r, false)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Deactivate</button>}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={8} style={{ ...td, color: '#888780', padding: 20 }}>No employees. Add one, or import the historical data.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#888780', marginTop: 10 }}>{filtered.length} employees</div>
    </div>
  );
}
