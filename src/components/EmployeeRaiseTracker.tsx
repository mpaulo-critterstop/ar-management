'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';
import CCDatePicker from '@/components/cc/DatePicker';

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
  const [view, setView] = useState<'active' | 'inactive'>('active');

  const load = () => fetch(`/api/payroll/raises?region=${region}`).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.employeeName) { alert('Employee name is required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/raises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing.id ? 'update' : 'add', region, ...editing }) });
    setSaving(false); setEditing(null); load();
  }
  async function setActive(row: any, active: boolean) {
    if (!confirm(`${active ? 'Reactivate' : 'Deactivate'} ${row.employeeName}?`)) return;
    await fetch('/api/payroll/raises', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', region, ...row, startDate: fmtDate(row.startDate), mostRecentRaiseDate: fmtDate(row.mostRecentRaiseDate), previousRaiseDate: fmtDate(row.previousRaiseDate), active }) });
    load();
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '0.5px solid #2A2A30', position: 'sticky', top: 0, background: '#1C1C21', zIndex: 2, whiteSpace: 'nowrap' };
  const thR: React.CSSProperties = { ...th, textAlign: 'right' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #232329', whiteSpace: 'nowrap' };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #35353C', marginTop: 4, background: '#26262C', color: '#F0EEE8' };

  const filtered = rows
    .filter(r => view === 'inactive' ? r.active === false : r.active !== false)
    .filter(r => !search || (r.employeeName + ' ' + (r.department || '') + ' ' + (r.position || '')).toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <a href={backHref} style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ {region === "International" ? "International" : "US"} Payroll</a>
      <div style={{ marginTop: 6 }}><CCPageHeader icon="📈" title="Employee & Raise Tracker" subtitle="Employee pay, positions, and raise history — days since last raise computed automatically" /></div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', position: 'sticky', top: 0, background: '#1C1C21', zIndex: 3, padding: '8px 0' }}>
        <button onClick={() => setEditing({ active: true, payType: region === 'International' ? 'monthly' : 'hourly' })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #9D8BE6', background: '#1C1C21', color: '#9D8BE6', fontWeight: 500, cursor: 'pointer' }}>+ Add employee</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, dept, position…" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 9, border: '1px solid #35353C', flex: 1, minWidth: 200, background: '#26262C', color: '#F0EEE8' }} />
        <div style={{ display: 'flex', gap: 4, background: '#232329', borderRadius: 8, padding: 3 }}>
          {(['active', 'inactive'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: view === v ? '#1C1C21' : 'transparent', color: view === v ? '#F0EEE8' : '#908E85', fontWeight: view === v ? 600 : 400, textTransform: 'capitalize' }}>{v}</button>
          ))}
        </div>
      </div>

      {editing && (
        <div style={{ border: '0.5px solid #9D8BE6', borderRadius: 12, padding: 16, background: '#241f36', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing.id ? 'Edit' : 'Add'} employee</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#908E85' }}>Name *<input value={editing.employeeName || ''} onChange={e => setEditing({ ...editing, employeeName: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Department<input value={editing.department || ''} onChange={e => setEditing({ ...editing, department: e.target.value })} placeholder="Technician" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Position<input value={editing.position || ''} onChange={e => setEditing({ ...editing, position: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Email<input value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Pay<input type="number" step="0.01" value={editing.currentSalary ?? ''} onChange={e => setEditing({ ...editing, currentSalary: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Pay type<select value={editing.payType || 'hourly'} onChange={e => setEditing({ ...editing, payType: e.target.value })} style={inp}><option value="hourly">Hourly</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Start date<CCDatePicker value={fmtDate(editing.startDate)} onChange={(v: string) => setEditing({ ...editing, startDate: v })} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Most recent raise<CCDatePicker value={fmtDate(editing.mostRecentRaiseDate)} onChange={(v: string) => setEditing({ ...editing, mostRecentRaiseDate: v })} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Raise amount<input value={editing.raiseAmount || ''} onChange={e => setEditing({ ...editing, raiseAmount: e.target.value })} placeholder="$23 to $24.25" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Previous raise date<CCDatePicker value={fmtDate(editing.previousRaiseDate)} onChange={(v: string) => setEditing({ ...editing, previousRaiseDate: v })} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Previous raise amount<input value={editing.previousRaiseAmount || ''} onChange={e => setEditing({ ...editing, previousRaiseAmount: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: '#908E85' }}>Notes<input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={inp} /></label>
          </div>
          <div style={{ marginTop: 10 }}><label style={{ fontSize: 12, color: '#908E85', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={editing.active !== false} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> Active</label></div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#9D8BE6', color: '#fff', fontWeight: 500, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'auto', background: '#1C1C21', maxHeight: '62vh' }}>
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
                  <td style={{ ...tdR, color: ds != null && ds > 365 ? '#E57C7C' : '#F0EEE8', fontWeight: ds != null && ds > 365 ? 600 : 400 }}>{ds != null ? ds : '—'}</td>
                  <td style={td}>{r.raiseAmount || '—'}</td>
                  <td style={{ ...tdR, whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing({ ...r, startDate: fmtDate(r.startDate), mostRecentRaiseDate: fmtDate(r.mostRecentRaiseDate), previousRaiseDate: fmtDate(r.previousRaiseDate) })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#9D8BE6', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                    {r.active === false
                      ? <button onClick={() => setActive(r, true)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#43B892', cursor: 'pointer' }}>Reactivate</button>
                      : <button onClick={() => setActive(r, false)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#E57C7C', cursor: 'pointer' }}>Deactivate</button>}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={9} style={{ ...td, color: '#908E85', padding: 20 }}>No employees yet. Add one, or import the historical data.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#908E85', marginTop: 10 }}>{filtered.length} employees · Days Since &gt; 365 flagged red</div>
    </div>
  );
}
