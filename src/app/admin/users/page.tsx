'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { ALL_MODULES } from '@/lib/access';

const ROLES = ['Admin', 'Manager', 'Accounts Receivable', 'Dispatch', 'CSR', 'Technician', 'Project Manager'];
const PERM_FLAGS = [
  { key: 'hidePmKpis', label: 'Hide PM KPIs table' },
  { key: 'ownDataOnly', label: 'Own data only (row-level restrict)' },
  { key: 'isTeamLeader', label: 'Team leader (sees own crew)' },
];

const blankForm = () => ({
  id: '', email: '', name: '', password: '', role: 'Accounts Receivable', office: '',
  modules: [] as string[], permissions: {} as any, pmName: '', techId: '',
});

export default function UsersAdminPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'Admin';
  const [users, setUsers] = useState<any[]>([]);
  const [pms, setPms] = useState<any[]>([]);
  const [techs, setTechs] = useState<any[]>([]);
  const [form, setForm] = useState(blankForm());
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, p, t] = await Promise.all([
      fetch('/api/admin/users').then(r => r.ok ? r.json() : []),
      fetch('/api/pm').then(r => r.ok ? r.json() : []),
      fetch('/api/field-performance/roster').then(r => r.ok ? r.json() : []),
    ]);
    setUsers(Array.isArray(u) ? u : []);
    setPms(Array.isArray(p) ? p : []);
    setTechs(Array.isArray(t) ? t : ((t as any)?.techs || []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleModule(m: string) {
    setForm(f => ({ ...f, modules: f.modules.includes(m) ? f.modules.filter(x => x !== m) : [...f.modules, m] }));
  }
  function togglePerm(k: string) {
    setForm(f => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions?.[k] } }));
  }
  function editUser(u: any) {
    setEditing(true);
    setForm({
      id: u.id, email: u.email, name: u.name, password: '', role: u.role, office: u.office || '',
      modules: u.modules || [], permissions: u.permissions || {}, pmName: u.pmName || '', techId: u.techId || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function resetForm() { setForm(blankForm()); setEditing(false); setMsg(''); }

  async function save() {
    setMsg('');
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch('/api/admin/users', {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || 'Error'); return; }
    setMsg(editing ? 'User updated.' : 'User created.');
    resetForm();
    load();
  }
  async function del(id: string) {
    if (!confirm('Delete this user?')) return;
    const res = await fetch(`/api/admin/users?id=${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || 'Error'); return; }
    load();
  }

  if (!isAdmin) {
    return <div style={{ padding: 40, color: '#888780' }}>Admin access only.</div>;
  }

  const input: React.CSSProperties = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', color: '#2C2C2A', width: '100%' };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: '#888780', marginBottom: 4, display: 'block' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: '#2C2C2A', marginBottom: 4 }}>User Access Management</h1>
      <p style={{ fontSize: 13, color: '#888780', marginBottom: 20 }}>Create logins and control which modules and data each user can access.</p>

      {/* Form */}
      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 18, marginBottom: 24, background: '#fff' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14, color: '#2C2C2A' }}>{editing ? 'Edit user' : 'New user'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div><label style={label}>Name</label><input style={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label style={label}>Email</label><input style={input} value={form.email} disabled={editing} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div><label style={label}>{editing ? 'New password (blank = keep)' : 'Password'}</label><input style={input} type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
          <div><label style={label}>Role</label>
            <select style={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div><label style={label}>Office (optional)</label>
            <select style={input} value={form.office} onChange={e => setForm({ ...form, office: e.target.value })}>
              <option value="">All offices</option>
              {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Modules (leave all unchecked to use role defaults)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_MODULES.map(m => (
              <button key={m} onClick={() => toggleModule(m)} type="button"
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  border: form.modules.includes(m) ? '1px solid #0052cc' : '0.5px solid #D3D1C7',
                  background: form.modules.includes(m) ? '#EAF1FC' : '#fff',
                  color: form.modules.includes(m) ? '#0052cc' : '#64748b', fontWeight: form.modules.includes(m) ? 600 : 400 }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Permissions</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PERM_FLAGS.map(p => (
              <button key={p.key} onClick={() => togglePerm(p.key)} type="button"
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  border: form.permissions?.[p.key] ? '1px solid #1D9E75' : '0.5px solid #D3D1C7',
                  background: form.permissions?.[p.key] ? '#EAF3DE' : '#fff',
                  color: form.permissions?.[p.key] ? '#27500A' : '#64748b', fontWeight: form.permissions?.[p.key] ? 600 : 400 }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div><label style={label}>Link to PM (for own-commission access)</label>
            <select style={input} value={form.pmName} onChange={e => setForm({ ...form, pmName: e.target.value })}>
              <option value="">— none —</option>
              {pms.map((p: any) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div><label style={label}>Link to Technician (for own FP data)</label>
            <select style={input} value={form.techId} onChange={e => setForm({ ...form, techId: e.target.value })}>
              <option value="">— none —</option>
              {techs.map((t: any) => <option key={t.techId} value={t.techId}>{t.techId} — {t.name}</option>)}
            </select>
          </div>
        </div>

        {msg && <div style={{ fontSize: 12, color: msg.includes('Error') || msg.includes('exists') ? '#A32D2D' : '#1D9E75', marginBottom: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 9, border: 'none', background: '#0052cc', color: '#fff', cursor: 'pointer' }}>
            {editing ? 'Save changes' : 'Create user'}
          </button>
          {editing && <button onClick={resetForm} style={{ padding: '8px 18px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>}
        </div>
      </div>

      {/* List */}
      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8F7F4' }}>
              {['Name', 'Email', 'Role', 'Modules', 'Identity', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading...</td></tr>
            ) : users.map(u => (
              <tr key={u.id} style={{ borderTop: '0.5px solid #F1EFE8' }}>
                <td style={{ padding: '8px 12px', color: '#2C2C2A' }}>{u.name}</td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>{u.email}</td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>{u.role}</td>
                <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 11 }}>{(u.modules || []).join(', ') || <span style={{ color: '#B8B6AE' }}>role default</span>}</td>
                <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 11 }}>{u.pmName || u.techId || '—'}</td>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  <button onClick={() => editUser(u)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#0052cc', marginRight: 6 }}>Edit</button>
                  <button onClick={() => del(u.id)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '0.5px solid #E4C4C4', background: '#fff', cursor: 'pointer', color: '#A32D2D' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
