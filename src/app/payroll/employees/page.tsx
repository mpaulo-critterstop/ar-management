'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState, useMemo } from 'react';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, DataTable as CCDataTable, Toolbar as CCToolbar, SearchBox as CCSearchBox, CustomerCell as CCCustomerCell } from '@/components/cc/Layout';
import { Btn as CCBtn, StatusPill as CCStatusPill } from '@/components/cc/Primitives';
import { Modal as CCModal, Label as CCLabel, Field as CCField, Select as CCSelect } from '@/components/cc/Modal';
import CCDatePicker from '@/components/cc/DatePicker';
import { cc } from '@/components/cc/tokens';

const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];
const ROLE_CODES = ['WP', 'PMP', 'IP', 'E', 'PM', 'M', 'C', 'D', 'AR', 'MKT', 'DE'];
const ROLE_LABEL: Record<string, string> = { WP: 'Wildlife Professional', PMP: 'Pest Management Professional', IP: 'Insulation', E: 'Executive', PM: 'Project Manager', M: 'Management', C: 'CSR', D: 'Dispatcher', AR: 'AR', MKT: 'Marketing', DE: 'Data Entry' };
const roleTone = (r: string): any => (['WP'].includes(r) ? 'blue' : ['PMP'].includes(r) ? 'green' : ['IP'].includes(r) ? 'violet' : ['PM'].includes(r) ? 'amber' : 'neutral');
const money = (n: number | null | undefined) => n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function EmployeesPage() {
  const [data, setData] = useState<any>({ employees: [], kpis: {} });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'directory' | 'probation' | 'raise'>('directory');
  const [office, setOffice] = useState('All');
  const [roleF, setRoleF] = useState('All');
  const [statusF, setStatusF] = useState('All');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null); // the employee in the drawer
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/payroll/employees').catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const emps: any[] = data.employees || [];
  const kpis = data.kpis || {};

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return emps.filter(e => {
      if (office !== 'All' && e.office !== office) return false;
      if (roleF !== 'All' && e.roleCode !== roleF) return false;
      if (statusF === 'Active' && !e.active) return false;
      if (statusF === 'Inactive' && e.active) return false;
      if (statusF === 'In probation' && e.probationStatus !== 'In probation') return false;
      if (q && !(`${e.fullName} ${e.techId || ''} ${e.email || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [emps, office, roleF, statusF, search]);

  const probationList = emps.filter(e => e.active && e.probationStatus === 'In probation');
  const raiseList = emps.filter(e => e.active && e.payType != null).slice().sort((a, b) => (b.daysSinceRaise || 0) - (a.daysSinceRaise || 0));

  const rateCell = (e: any) => {
    const eh = e.effHourly;
    return <div><div style={{ fontWeight: 700, color: cc.ink, fontVariantNumeric: 'tabular-nums' }}>{eh != null ? money(eh) + '/hr' : '—'}</div>
      {e.payType === 'Salary' && e.annualSalary ? <div style={{ fontSize: 11, color: cc.faint }}>{money(e.annualSalary)}/yr</div> : null}</div>;
  };

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="👥" title="Employees" subtitle="One record per person — roster, role, probation, pay & raises in one place"
        actions={<CCBtn variant="primary" onClick={() => setEditing({ _new: true, payType: 'Hourly', region: 'US', status: 'Active', active: true })}>＋ Add employee</CCBtn>} />

      {view === 'directory' && <>
        <CCKpiStrip items={[
          { icon: '🟢', label: 'Active employees', value: loading ? '…' : (kpis.activeTotal ?? 0), tone: 'blue', delta: 'across offices' },
          { icon: '⏳', label: 'In probation', value: loading ? '…' : (kpis.inProbation ?? 0), tone: 'amber', delta: `${kpis.notInOnPay ?? 0} not in OnPay → open`, deltaTone: 'amber' },
          { icon: '🔧', label: 'Field techs', value: loading ? '…' : (kpis.fieldTechs ?? 0), tone: 'green', delta: 'WP · PMP · IP' },
          { icon: '🧑‍💼', label: 'Office / admin', value: loading ? '…' : (kpis.officeAdmin ?? 0), tone: 'violet', delta: 'PM · M · C · D · AR …' },
          { icon: '📈', label: 'Raise due (90d+)', value: loading ? '…' : (kpis.raiseDue ?? 0), tone: 'red', delta: 'review pay → open', deltaTone: 'red' },
        ]} />
        {/* make the two drill-in tiles clickable (overlay buttons since KpiStrip isn't clickable) */}
        <div style={{ display: 'flex', gap: 10, marginTop: -16, marginBottom: 14 }}>
          <CCBtn variant="secondary" style={{ fontSize: 12 }} onClick={() => setView('probation')}>⏳ Open Probation Tracker</CCBtn>
          <CCBtn variant="secondary" style={{ fontSize: 12 }} onClick={() => setView('raise')}>📈 Open Raise Tracker</CCBtn>
        </div>

        <CCToolbar>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {OFFICES.map(o => { const on = office === o; return <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? cc.blue : cc.line}`, background: on ? cc.bluebg : cc.panel, color: on ? cc.blue : cc.muted }}>{o}</button>; })}
          </div>
          <CCSelect value={roleF} onChange={e => setRoleF(e.target.value)} style={{ width: 'auto' }}><option value="All">All roles</option>{ROLE_CODES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]} ({r})</option>)}</CCSelect>
          <CCSelect value={statusF} onChange={e => setStatusF(e.target.value)} style={{ width: 'auto' }}><option value="All">All statuses</option><option>Active</option><option>In probation</option><option>Inactive</option></CCSelect>
          <CCSearchBox value={search} onChange={setSearch} placeholder="Search name, Tech ID, email…" />
        </CCToolbar>

        <CCDataTable
          rowKey={(e: any) => e.id}
          empty={loading ? 'Loading…' : 'No employees match.'}
          cols={[
            { key: 'emp', label: 'Employee', render: (e: any) => <div onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}><CCCustomerCell name={e.fullName} sub={e.roleCode ? ROLE_LABEL[e.roleCode] : (e.department || undefined)} /></div> },
            { key: 'techId', label: 'Tech ID', render: (e: any) => <span style={{ fontVariantNumeric: 'tabular-nums', color: cc.muted }}>{e.techId || '—'}</span> },
            { key: 'role', label: 'Role', render: (e: any) => e.roleCode ? <CCStatusPill tone={roleTone(e.roleCode)}>{e.roleCode}</CCStatusPill> : '—' },
            { key: 'office', label: 'Office', render: (e: any) => e.office ? <CCStatusPill tone="blue">{e.office}</CCStatusPill> : '—' },
            { key: 'hire', label: 'Hire date', render: (e: any) => <span style={{ color: cc.muted, fontSize: 12.5 }}>{fmtD(e.hireDate)}</span> },
            { key: 'status', label: 'Status', render: (e: any) => e.active ? (e.probationStatus === 'In probation' ? <CCStatusPill tone="amber">In probation</CCStatusPill> : <CCStatusPill tone="green">Active</CCStatusPill>) : <CCStatusPill tone="neutral">Inactive</CCStatusPill> },
            { key: 'pt', label: 'Pay type', render: (e: any) => <CCStatusPill tone={e.payType === 'Salary' ? 'violet' : 'neutral'}>{e.payType}</CCStatusPill> },
            { key: 'rate', label: 'Rate (hr)', align: 'right', render: rateCell },
          ]}
          rows={filtered}
        />
      </>}

      {view === 'probation' && <>
        <button onClick={() => setView('directory')} style={{ background: 'none', border: 'none', color: cc.muted, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>↩ Back to Employees</button>
        <div style={{ fontSize: 19, fontWeight: 600, color: cc.ink }}>Probation Tracker</div>
        <p style={{ fontSize: 13, color: cc.muted, margin: '2px 0 16px' }}>New hires still in their 90-day probation window.</p>
        <CCDataTable
          rowKey={(e: any) => e.id}
          empty="No one in probation 🎉"
          cols={[
            { key: 'emp', label: 'Employee', render: (e: any) => <div onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}><CCCustomerCell name={e.fullName} sub={e.roleCode ? ROLE_LABEL[e.roleCode] : undefined} /></div> },
            { key: 'techId', label: 'Tech ID', render: (e: any) => <span style={{ fontVariantNumeric: 'tabular-nums', color: cc.muted }}>{e.techId || '—'}</span> },
            { key: 'hire', label: 'Hire date', render: (e: any) => <span style={{ color: cc.muted, fontSize: 12.5 }}>{fmtD(e.hireDate)}</span> },
            { key: 'ends', label: 'Probation ends', render: (e: any) => <span style={{ color: cc.muted, fontSize: 12.5 }}>{fmtD(e.probationEndDate)}</span> },
            { key: 'left', label: 'Days left', align: 'right', render: (e: any) => { const d = e.daysUntilEligible; return <span style={{ fontWeight: 700, color: d != null && d <= 0 ? cc.green : cc.ink, fontVariantNumeric: 'tabular-nums' }}>{d == null ? '—' : d <= 0 ? 'Eligible' : d + 'd'}</span>; } },
            { key: 'onpay', label: 'OnPay', align: 'right', render: (e: any) => e.addedToOnPay ? <CCStatusPill tone="green">✓ Added</CCStatusPill> : <CCBtn variant="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={async () => { await fetch('/api/payroll/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markOnPay', id: e.id }) }); load(); }}>Mark added</CCBtn> },
          ]}
          rows={probationList}
        />
      </>}

      {view === 'raise' && <>
        <button onClick={() => setView('directory')} style={{ background: 'none', border: 'none', color: cc.muted, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>↩ Back to Employees</button>
        <div style={{ fontSize: 19, fontWeight: 600, color: cc.ink }}>Raise Tracker</div>
        <p style={{ fontSize: 13, color: cc.muted, margin: '2px 0 16px' }}>Pay, positions, and raise history — days since last raise computed automatically.</p>
        <CCDataTable
          rowKey={(e: any) => e.id}
          empty="No pay records yet."
          cols={[
            { key: 'emp', label: 'Employee', render: (e: any) => <div onClick={() => setEditing(e)} style={{ cursor: 'pointer' }}><CCCustomerCell name={e.fullName} sub={e.roleCode ? ROLE_LABEL[e.roleCode] : (e.department || undefined)} /></div> },
            { key: 'pt', label: 'Pay type', render: (e: any) => <CCStatusPill tone={e.payType === 'Salary' ? 'violet' : 'neutral'}>{e.payType}</CCStatusPill> },
            { key: 'rate', label: 'Rate (hr)', align: 'right', render: rateCell },
            { key: 'last', label: 'Last raise', render: (e: any) => <span style={{ color: cc.muted, fontSize: 12.5 }}>{fmtD(e.mostRecentRaiseDate)}</span> },
            { key: 'since', label: 'Days since', align: 'right', render: (e: any) => { const d = e.daysSinceRaise; if (d == null) return <span style={{ color: cc.faint }}>—</span>; return <CCStatusPill tone={d >= 90 ? 'red' : d >= 60 ? 'amber' : 'green'}>{d}d</CCStatusPill>; } },
            { key: 'amt', label: 'Last change', render: (e: any) => <span style={{ color: cc.ink2, fontSize: 12.5 }}>{e.raiseAmount || '—'}</span> },
          ]}
          rows={raiseList}
        />
      </>}

      {editing && <EmployeeDrawer emp={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} saving={saving} setSaving={setSaving} />}
    </div>
  );
}

function EmployeeDrawer({ emp, onClose, onSaved, saving, setSaving }: any) {
  const [f, setF] = useState<any>({ ...emp });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const eh = f.payType === 'Salary' ? (f.annualSalary ? Number(f.annualSalary) / 52 / 40 : null) : (f.hourlyRate != null && f.hourlyRate !== '' ? Number(f.hourlyRate) : null);

  async function save() {
    setSaving(true);
    await fetch('/api/payroll/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: emp._new ? 'add' : 'update', ...f }) });
    setSaving(false); onSaved();
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'flex-end', zIndex: 60 }}>
      <div style={{ width: 540, maxWidth: '96vw', height: '100%', background: cc.panel, borderLeft: `1px solid ${cc.line2}`, overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: cc.ink }}>{emp._new ? 'Add employee' : f.fullName}</div>
          <button onClick={onClose} style={{ fontSize: 20, border: 'none', background: 'none', color: cc.muted, cursor: 'pointer' }}>×</button>
        </div>

        <Sec title="Identity">
          <CCLabel style={{ marginTop: 0 }}>Full name</CCLabel><CCField value={f.fullName || ''} onChange={e => set('fullName', e.target.value)} />
          <CCLabel>Tech ID</CCLabel><CCField value={f.techId || ''} onChange={e => set('techId', e.target.value)} placeholder="W-063 / P-029 / I-035" />
          <CCLabel>Email</CCLabel><CCField value={f.email || ''} onChange={e => set('email', e.target.value)} />
        </Sec>

        <Sec title="Role & office">
          <CCLabel style={{ marginTop: 0 }}>Role</CCLabel>
          <CCSelect value={f.roleCode || ''} onChange={e => set('roleCode', e.target.value)}><option value="">—</option>{ROLE_CODES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]} ({r})</option>)}</CCSelect>
          <CCLabel>Office</CCLabel>
          <CCSelect value={f.office || ''} onChange={e => set('office', e.target.value)}><option value="">—</option>{['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}</CCSelect>
          <CCLabel>Department</CCLabel><CCField value={f.department || ''} onChange={e => set('department', e.target.value)} placeholder="Technician / CSR-Admin / Management…" />
          <CCLabel>Region</CCLabel>
          <CCSelect value={f.region || 'US'} onChange={e => set('region', e.target.value)}><option>US</option><option>International</option></CCSelect>
        </Sec>

        <Sec title="Employment">
          <CCLabel style={{ marginTop: 0 }}>Hire date</CCLabel><div style={{ marginTop: 4 }}><CCDatePicker value={f.hireDate ? String(f.hireDate).split('T')[0] : ''} onChange={(v: string) => set('hireDate', v)} /></div>
          <CCLabel>Status</CCLabel>
          <CCSelect value={f.status || 'Active'} onChange={e => set('status', e.target.value)}><option>Active</option><option>Inactive</option><option>Terminated</option></CCSelect>
          <CCLabel>Term date</CCLabel><div style={{ marginTop: 4 }}><CCDatePicker value={f.termDate ? String(f.termDate).split('T')[0] : ''} onChange={(v: string) => set('termDate', v)} /></div>
        </Sec>

        <Sec title="Probation">
          <CCLabel style={{ marginTop: 0 }}>Probation ends</CCLabel><div style={{ marginTop: 4 }}><CCDatePicker value={f.probationEndDate ? String(f.probationEndDate).split('T')[0] : ''} onChange={(v: string) => set('probationEndDate', v)} /></div>
          <CCLabel>Probation status</CCLabel>
          <CCSelect value={f.probationStatus || ''} onChange={e => set('probationStatus', e.target.value)}><option value="">Not applicable</option><option>In probation</option><option>Done - added</option></CCSelect>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: cc.ink2 }}>
            <input type="checkbox" checked={!!f.addedToOnPay} onChange={e => set('addedToOnPay', e.target.checked)} /> Added to OnPay
          </label>
        </Sec>

        <Sec title="Pay & raises">
          <CCLabel style={{ marginTop: 0 }}>Pay type</CCLabel>
          <CCSelect value={f.payType || 'Hourly'} onChange={e => set('payType', e.target.value)}><option>Hourly</option><option>Salary</option></CCSelect>
          {f.payType === 'Salary'
            ? <><CCLabel>Annual salary</CCLabel><CCField type="number" value={f.annualSalary ?? ''} onChange={e => set('annualSalary', e.target.value)} placeholder="75000" /></>
            : <><CCLabel>Hourly rate</CCLabel><CCField type="number" step="0.01" value={f.hourlyRate ?? ''} onChange={e => set('hourlyRate', e.target.value)} placeholder="18.00" /></>}
          <div style={{ marginTop: 10, padding: '10px 12px', background: cc.greenbg, borderRadius: 8, fontSize: 13, color: cc.green, fontWeight: 600 }}>
            Effective hourly (payroll): {eh != null ? money(eh) + ' / hr' : '—'}
            {f.payType === 'Salary' && <span style={{ color: cc.faint, fontWeight: 400, fontSize: 11 }}> &nbsp;(annual ÷ 52 ÷ 40)</span>}
          </div>
          <CCLabel>Last raise date</CCLabel><div style={{ marginTop: 4 }}><CCDatePicker value={f.mostRecentRaiseDate ? String(f.mostRecentRaiseDate).split('T')[0] : ''} onChange={(v: string) => set('mostRecentRaiseDate', v)} /></div>
          <CCLabel>Last change</CCLabel><CCField value={f.raiseAmount || ''} onChange={e => set('raiseAmount', e.target.value)} placeholder="$18.00 → $20.00" />
          <CCLabel>PTO</CCLabel><CCField value={f.pto || ''} onChange={e => set('pto', e.target.value)} />
        </Sec>

        <Sec title="Notes / history">
          <textarea value={f.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} style={{ width: '100%', background: cc.panel2, border: `1px solid ${cc.line2}`, borderRadius: 8, padding: '10px 12px', color: cc.ink, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        </Sec>

        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <CCBtn variant="primary" onClick={save} disabled={saving || !f.fullName} style={{ flex: 1, justifyContent: 'center' }}>{saving ? 'Saving…' : 'Save changes'}</CCBtn>
          {!emp._new && f.active && <CCBtn variant="danger" onClick={async () => { await fetch('/api/payroll/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deactivate', id: f.id }) }); onSaved(); }}>Deactivate</CCBtn>}
          {!emp._new && !f.active && <CCBtn variant="secondary" onClick={async () => { await fetch('/api/payroll/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reactivate', id: f.id }) }); onSaved(); }}>Reactivate</CCBtn>}
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginTop: 22 }}>
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: cc.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{title}</span><span style={{ flex: 1, height: 1, background: cc.line }} />
    </div>
    {children}
  </div>;
}
