'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const fmtDate = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '';
function daysSince(d: any): number | null { if (!d) return null; return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }
function fmtPay(v: number | null, t: string | null): string {
  if (v == null) return '—';
  const n = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return t === 'annual' ? `$${v.toLocaleString()}/yr` : t === 'monthly' ? `$${n}/mo` : `$${n}/hr`;
}

export default function EmployeeRaiseTracker({ region, backHref }: { region: 'US' | 'International'; backHref: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = () => fetch(`/api/payroll/raises?region=${region}`).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.employeeName) { alert('Employee name is required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/raises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing.id ? 'update' : 'add', region, ...editing }) });
    setSaving(false); setEditing(null); load();
  }
  async function del(id: string, name: string) {
    if (!confirm(`Delete ${name} from the raise tracker?`)) return;
    await fetch('/api/payroll/raises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) });
    load();
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', position: 'sticky', top: 0, background: '#fff', zIndex: 2, whiteSpace: 'nowrap' };
  const thR: React.CSSProperties = { ...th, textAlign: 'right' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 };

  const filtered = rows
    .filter(r => showInactive || r.active !== false)
    .filter(r => !search || (r.employeeName + ' ' + (r.department || '') + ' ' + (r.position || '')).toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href={backHref} style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← {region === "International" ? "International" : "US"} Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Employee and Raise Tracker</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 18px' }}>Employee pay, positions, and raise history. Days since last raise is computed automatically.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', position: 'sticky', top: 0, background: '#fff', zIndex: 3, padding: '8px 0' }}>
        <button onClick={() => setEditing({ active: true, payType: region === 'International' ? 'monthly' : 'hourly' })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>+ Add employee</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, dept, position…" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', flex: 1, minWidth: 200 }} />
        <label style={{ fontSize: 12, color: '#888780', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>

      {editing && (
        <div style={{ border: '0.5px solid #534AB7', borderRadius: 12, padding: 16, background: '#F7F6FD', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing.id ? 'Edit' : 'Add'} employee</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#888780' }}>Name *<input value={editing.employeeName || ''} onChange={e => setEditing({ ...editing, employeeName: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Department<input value={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })} placeholder="Technician" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Position<input value={editing.position || ''} onChange={e => setEditing({ ...editing, position: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Email<input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Pay<input type="number" step="0.01" value={editing.currentSalary ?? ''} onChange={e => setEditing({ ...editing, currentSalary: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Pay type<select value={editing.payType || 'hourly'} onChange={e => setEditing({ ...editing, payType: e.target.value })} style={inp}><option value="hourly">Hourly</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Start date<input type="date" value={fmtDate(editing.startDate)} onChange={e => setEditing({ ...editing, startDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Most recent raise<input type="date" value={fmtDate(editing.mostRecentRaiseDate)} onChange={e => setEditing({ ...editing, mostRecentRaiseDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Raise amount<input value={editing.raiseAmount || ''} onChange={e => setEditing({ ...editing, raiseAmount: e.target.value })} placeholder="$23 to $24.25" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Previous raise date<input type="date" value={fmtDate(editing.previousRaiseDate)} onChange={e => setEditing({ ...editing, previousRaiseDate: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Previous raise amount<input value={editing.previousRaiseAmount || ''} onChange={e => setEditing({ ...editing, previousRaiseAmount: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780' }}>Notes<input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={inp} /></label>
          </div>
          <div style={{ marginTop: 10 }}><label style={{ fontSize: 12, color: '#888780', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={editing.active !== false} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> Active</label></div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontWeight: 500, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', maxHeight: '62vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Employee</th><th style={th}>Dept</th><th style={th}>Position</th>
            <th style={thR}>Pay</th><th style={th}>Start</th><th style={th}>Last Raise</th><th style={thR}>Days Since</th><th style={th}>Raise Amt</th><th style={thR}></th>
          </tr></thead>
          <tbody>
            {filtered.map(r => {
              const ds = daysSince(r.mostRecentRaiseDate);
              return (
                <tr key={r.id} style={{ opacity: r.active === false ? 0.5 : 1 }}>
                  <td style={td}>{r.employeeName}</td>
                  <td style={td}>{r.department || '—'}</td>
                  <td style={td}>{r.position || '—'}</td>
                  <td style={tdR}>{fmtPay(r.currentSalary, r.payType)}</td>
                  <td style={td}>{fmtDate(r.startDate) || '—'}</td>
                  <td style={td}>{fmtDate(r.mostRecentRaiseDate) || '—'}</td>
                  <td style={{ ...tdR, color: ds != null && ds > 365 ? '#b91c1c' : '#2C2C2A', fontWeight: ds != null && ds > 365 ? 600 : 400 }}>{ds != null ? ds : '—'}</td>
                  <td style={td}>{r.raiseAmount || '—'}</td>
                  <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing({ ...r, startDate: fmtDate(r.startDate), mostRecentRaiseDate: fmtDate(r.mostRecentRaiseDate), previousRaiseDate: fmtDate(r.previousRaiseDate) })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#534AB7', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                    <button onClick={() => del(r.id, r.employeeName)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Del</button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={9} style={{ ...td, color: '#888780', padding: 20 }}>No employees yet. Add one, or import the historical data.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#888780', marginTop: 10 }}>{filtered.length} employees · Days Since &gt; 365 flagged red</div>
    </div>
  );
}
