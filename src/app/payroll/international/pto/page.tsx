'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const fmtDate = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '';

export default function PtoTrackerPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null); // leave being added/edited
  const [allotEdit, setAllotEdit] = useState<any>(null); // allotment being edited
  const [saving, setSaving] = useState(false);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState('');

  const load = () => fetch(`/api/payroll/pto?year=${year}`).then(r => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, [year]);

  async function saveLeave() {
    if (!editing?.name || !editing?.startDate) { alert('Name and start date are required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/pto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing.id ? 'updateLeave' : 'addLeave', year, ...editing }) });
    setSaving(false); setEditing(null); load();
  }
  async function delLeave(id: string) { if (!confirm('Delete this leave entry?')) return; const r = await fetch('/api/payroll/pto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteLeave', id }) }); if (!r.ok) alert((await r.json()).error || 'Could not delete.'); load(); }
  async function markUsed(id: string) { if (!confirm('Mark this leave as used? Once used, it can no longer be edited or deleted.')) return; await fetch('/api/payroll/pto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markUsed', id }) }); load(); }
  async function saveAllot() {
    if (!allotEdit?.name) { alert('Name is required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/pto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setAllotment', year, ...allotEdit }) });
    setSaving(false); setAllotEdit(null); load();
  }
  async function delEmployee(name: string) {
    if (!confirm(`Remove ${name}'s ${year} allotment? (Leave-log entries are kept.)`)) return;
    await fetch('/api/payroll/pto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteAllotment', name, year }) });
    load();
  }

  const summary = data?.summary || [];
  const allLeaves = data?.leaves || [];
  const leaves = allLeaves.filter((l: any) => (!fName || l.name === fName) && (!fType || l.leaveType === fType));
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 };
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll/international" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← International Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>PTO Tracker</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 18px' }}>PTO and holiday balances. Used and remaining are computed from the leave log below. Allotments renew annually.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: '#888780' }}>Year:</label>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3' }}>
          {[year + 1, year, year - 1, year - 2].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Employee allotments + usage table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Employees ({year})</div>
        <button onClick={() => setAllotEdit({ name: '', ptoAllotment: 15, holidayAllotment: 6, isNew: true })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>+ Add employee</button>
      </div>

      {allotEdit && (
        <div style={{ border: '0.5px solid #534AB7', borderRadius: 12, padding: 16, background: '#F7F6FD', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{allotEdit.isNew ? 'Add employee' : `Edit — ${allotEdit.name}`} ({year})</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {allotEdit.isNew && <label style={{ fontSize: 12, color: '#888780' }}>Name<input value={allotEdit.name} onChange={e => setAllotEdit({ ...allotEdit, name: e.target.value })} placeholder="Employee name" style={{ ...inp, width: 200 }} /></label>}
            <label style={{ fontSize: 12, color: '#888780' }}>PTO days<input type="number" step="0.5" value={allotEdit.ptoAllotment} onChange={e => setAllotEdit({ ...allotEdit, ptoAllotment: e.target.value })} style={{ ...inp, width: 120 }} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Holiday days<input type="number" step="0.5" value={allotEdit.holidayAllotment} onChange={e => setAllotEdit({ ...allotEdit, holidayAllotment: e.target.value })} style={{ ...inp, width: 120 }} /></label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={saveAllot} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setAllotEdit(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 26 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Name</th>
            <th style={{ ...th, textAlign: 'right' }}>PTO (days)</th>
            <th style={{ ...th, textAlign: 'right' }}>Holiday (days)</th>
            <th style={{ ...th, textAlign: 'right' }}>Used PTO</th>
            <th style={{ ...th, textAlign: 'right' }}>Used Holiday</th>
            <th style={{ ...th, textAlign: 'right' }}>PTO Left</th>
            <th style={{ ...th, textAlign: 'right' }}>Holiday Left</th>
            <th style={{ ...th, textAlign: 'right' }}></th>
          </tr></thead>
          <tbody>
            {summary.map((s: any) => (
              <tr key={s.name}>
                <td style={td}>{s.name}</td>
                <td style={{ ...td, textAlign: 'right' }}>{s.pto.allotment}</td>
                <td style={{ ...td, textAlign: 'right' }}>{s.holiday.allotment}</td>
                <td style={{ ...td, textAlign: 'right' }}>{s.pto.used}</td>
                <td style={{ ...td, textAlign: 'right' }}>{s.holiday.used}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: s.pto.remaining <= 0 ? '#b91c1c' : '#128a3f' }}>{s.pto.remaining}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: s.holiday.remaining <= 0 ? '#b91c1c' : '#128a3f' }}>{s.holiday.remaining}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setAllotEdit({ name: s.name, ptoAllotment: s.pto.allotment, holidayAllotment: s.holiday.allotment })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#534AB7', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                  <button onClick={() => delEmployee(s.name)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Del</button>
                </td>
              </tr>
            ))}
            {!summary.length && <tr><td colSpan={8} style={{ ...td, color: '#888780', padding: 20 }}>No employees for {year}. Add one above.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Leave log */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Leave Log</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={fName} onChange={e => setFName(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '0.5px solid #E8E7E3' }}>
            <option value="">All names</option>
            {[...new Set(allLeaves.map((l: any) => l.name))].sort().map((n: any) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={fType} onChange={e => setFType(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '0.5px solid #E8E7E3' }}>
            <option value="">All types</option><option value="PTO">PTO</option><option value="Holiday">Holiday</option>
          </select>
          <button onClick={() => setEditing({ leaveType: 'PTO', businessDays: 1 })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>+ Add leave</button>
        </div>
      </div>

      {editing && (
        <div style={{ border: '0.5px solid #534AB7', borderRadius: 12, padding: 16, background: '#F7F6FD', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing.id ? 'Edit' : 'Add'} leave</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#888780' }}>Name *<select value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inp}><option value="">Select…</option>{[...new Set([...summary.map((s: any) => s.name), 'Mark Paulo', 'Ana Navas', 'Anni Suutari'])].map((n: any) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Type<select value={editing.leaveType || 'PTO'} onChange={e => setEditing({ ...editing, leaveType: e.target.value })} style={inp}><option value="PTO">PTO</option><option value="Holiday">Holiday</option></select></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Start *<input type="date" value={fmtDate(editing.startDate)} onChange={e => setEditing({ ...editing, startDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>End<input type="date" value={fmtDate(editing.endDate)} onChange={e => setEditing({ ...editing, endDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Business days<input type="number" step="0.5" value={editing.businessDays ?? ''} onChange={e => setEditing({ ...editing, businessDays: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Notes<input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Holiday name…" style={inp} /></label>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button onClick={saveLeave} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', maxHeight: '50vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>Name</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>Type</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>Start</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>End</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2, textAlign: 'right' }}>Days</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>Notes</th>
            <th style={{ ...th, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}></th>
          </tr></thead>
          <tbody>
            {leaves.map((l: any) => (
              <tr key={l.id}>
                <td style={td}>{l.name}</td>
                <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: l.leaveType === 'Holiday' ? '#EEEDFE' : '#E1F5EE', color: l.leaveType === 'Holiday' ? '#534AB7' : '#0F6E56' }}>{l.leaveType}</span></td>
                <td style={td}>{fmtDate(l.startDate)}</td>
                <td style={td}>{fmtDate(l.endDate)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.businessDays}</td>
                <td style={td}>{l.notes || '—'}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {l.used ? (
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: '#E1F5EE', color: '#0F6E56', fontWeight: 600 }}>✓ Used</span>
                  ) : (<>
                    <button onClick={() => markUsed(l.id)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #128a3f', background: '#fff', color: '#128a3f', cursor: 'pointer', marginRight: 6 }}>Used</button>
                    <button onClick={() => setEditing({ ...l, startDate: fmtDate(l.startDate), endDate: fmtDate(l.endDate) })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#534AB7', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                    <button onClick={() => delLeave(l.id)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Del</button>
                  </>)}
                </td>
              </tr>
            ))}
            {!leaves.length && <tr><td colSpan={7} style={{ ...td, color: '#888780', padding: 20 }}>No leave entries for {year}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
