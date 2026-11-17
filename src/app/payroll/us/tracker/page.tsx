'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, SearchBox as CCSearchBox } from '@/components/cc/Layout';
import { Btn as CCBtn } from '@/components/cc/Primitives';
import { cc } from '@/components/cc/tokens';

const money = (n: number) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const roleTone = (r: string): string => (['WP'].includes(r) ? cc.bluebg : ['PMP'].includes(r) ? cc.greenbg : ['IP'].includes(r) ? cc.violetbg : ['PM'].includes(r) ? cc.amberbg : cc.panel2);
const roleFg = (r: string): string => (['WP'].includes(r) ? cc.blue : ['PMP'].includes(r) ? cc.green : ['IP'].includes(r) ? cc.violet : ['PM'].includes(r) ? cc.amber : cc.muted);

// Monday-anchored list of recent pay-period dates (Sundays, matching the sheet's week naming) — last 16 weeks.
function recentWeeks(): string[] {
  const out: string[] = [];
  const d = new Date();
  // snap to the most recent Sunday
  d.setDate(d.getDate() - d.getDay());
  for (let i = 0; i < 16; i++) { out.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() - 7); }
  return out;
}
const fmtWeek = (s: string) => { const [y, m, d] = s.split('-').map(Number); const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${MON[m - 1]} ${d}, ${y}`; };

export default function PayrollTrackerPage() {
  const [dbWeeks, setDbWeeks] = useState<{ date: string; status: string }[]>([]);
  // merge: recent weeks (so you can start a new/upcoming one) + all weeks that exist in the DB (history), newest first
  const weekOptions = (() => {
    const map = new Map<string, string>();
    for (const w of dbWeeks) map.set(w.date, w.status); // DB history is the source of truth
    // add only the 2 most-recent recentWeeks() that aren't already in the DB (to start a new upcoming week)
    for (const w of recentWeeks().slice(0, 2)) if (!map.has(w)) map.set(w, 'new');
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, status]) => ({ date, status }));
  })();
  const [week, setWeek] = useState(recentWeeks()[0]);

  const [didInit, setDidInit] = useState(false);
  useEffect(() => {
    fetch('/api/payroll/tracker?list=1&region=US').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.weeks?.length) {
        const list = d.weeks.map((w: any) => ({ date: new Date(w.weekDate).toISOString().split('T')[0], status: w.status }));
        setDbWeeks(list);
        // open on the most recent week that actually has data (newest finalized/backfilled), else newest
        if (!didInit) { const newest = list.map((w: any) => w.date).sort().reverse()[0]; if (newest) setWeek(newest); setDidInit(true); }
      }
    }).catch(() => {});
  }, []);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, any>>({}); // entryId -> {field: val}

  const load = useCallback(async (w: string) => {
    setLoading(true); setEdits({});
    const res = await fetch(`/api/payroll/tracker?week=${w}&region=US`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => { load(week); }, [week, load]);

  const entries: any[] = data?.entries || [];
  const finalized = data?.week?.status === 'finalized';

  // merge local edits over server values for display + calc
  const merged = entries.map(en => ({ ...en, ...(edits[en.id] || {}) }));
  const calc = (en: any) => {
    const rate = Number(en.rate) || 0, reg = Number(en.regularHours) || 0, ot = Number(en.otHours) || 0;
    const regTotal = rate * reg;
    const otTotal = en.otTotalOverride != null ? Number(en.otTotalOverride) : rate * 1.5 * ot;
    const computedFinal = regTotal + otTotal - (Number(en.tolls) || 0) - (Number(en.otherDeductions) || 0) + (Number(en.otherEarnings) || 0) + (Number(en.commissions) || 0) + (Number(en.bonus) || 0);
    const finalTotal = en.finalTotalOverride != null ? Number(en.finalTotalOverride) : computedFinal;
    return { regTotal, otTotal, finalTotal };
  };

  const filtered = merged.filter(en => !search.trim() || en.name.toLowerCase().includes(search.trim().toLowerCase()));

  // totals
  const T = filtered.reduce((a, en) => {
    const c = calc(en);
    a.reg += Number(en.regularHours) || 0; a.ot += Number(en.otHours) || 0;
    a.regT += c.regTotal; a.otT += c.otTotal; a.final += c.finalTotal;
    a.tolls += Number(en.tolls) || 0; a.ded += Number(en.otherDeductions) || 0;
    a.earn += Number(en.otherEarnings) || 0; a.comm += Number(en.commissions) || 0; a.bonus += Number(en.bonus) || 0;
    return a;
  }, { reg: 0, ot: 0, regT: 0, otT: 0, final: 0, tolls: 0, ded: 0, earn: 0, comm: 0, bonus: 0 });

  // debounced autosave
  const saveTimer = useRef<any>(null);
  function edit(entryId: string, field: string, value: string) {
    setEdits(p => ({ ...p, [entryId]: { ...(p[entryId] || {}), [field]: value } }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(entryId);
      await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveEntry', entryId, [field]: value }) }).catch(() => {});
      setSaving(null);
    }, 700);
  }

  const inputStyle = (w: number, kind?: 'ot' | 'ded' | 'ern'): React.CSSProperties => ({
    width: w, background: cc.panel2, border: `1px solid ${kind === 'ded' ? '#4a2626' : kind === 'ot' ? '#4a3a1e' : cc.line2}`, borderRadius: 6,
    padding: '5px 7px', color: kind === 'ot' ? cc.amber : cc.ink, fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  });
  const th: React.CSSProperties = { textAlign: 'right', padding: '9px 9px', fontSize: 10, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: cc.muted, background: cc.panel2, borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 };
  const thL = { ...th, textAlign: 'left' as const };
  const td: React.CSSProperties = { padding: '6px 9px', borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: cc.ink2 };
  const tdL = { ...td, textAlign: 'left' as const };

  function num(en: any, field: string, w: number, kind?: 'ot' | 'ded' | 'ern') {
    return <input disabled={finalized} value={en[field] ?? ''} onChange={e => edit(en.id, field, e.target.value)}
      style={{ ...inputStyle(w, kind), opacity: finalized ? 0.6 : 1 }} />;
  }

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: '30px 34px 70px' }}>
      <Link href="/payroll/us" style={{ fontSize: 13, color: cc.muted, textDecoration: 'none', display: 'inline-block', marginBottom: 6 }}>↩ US Payroll</Link>
      <CCPageHeader icon="🧮" title="Main Payroll Tracker" subtitle="Enter hours, OT, earnings & deductions per employee — OnPay hours pass through; Final Total is the target to match"
        actions={<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={week} onChange={e => setWeek(e.target.value)} style={{ fontSize: 13, padding: '9px 13px', borderRadius: 10, border: `1px solid ${cc.line2}`, background: cc.panel2, color: cc.ink }}>
            {weekOptions.map((w, i) => <option key={w.date} value={w.date}>Week of {fmtWeek(w.date)}{i === 0 ? ' (current)' : w.status === 'finalized' ? ' ✓' : ''}</option>)}
          </select>
          <CCBtn variant="secondary" onClick={() => exportOnpay(filtered, calc)}>⇪ Export</CCBtn>
          {finalized
            ? <CCBtn variant="secondary" onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', weekId: data.week.id }) }); load(week); }}>↺ Reopen</CCBtn>
            : <CCBtn variant="primary" onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'finalize', weekId: data.week.id }) }); load(week); }}>✓ Finalize week</CCBtn>}
        </div>} />

      {finalized && <div style={{ background: cc.greenbg, border: '1px solid #2e5a4c', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: cc.green, marginBottom: 14 }}>✓ This week is finalized (read-only). Reopen to edit.</div>}
      {!finalized && <div style={{ background: cc.amberbg, border: '1px solid #4a3a1e', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: cc.amber, marginBottom: 14 }}>⚠ Draft — saved as you type. OT paid at 1.5×. OnPay Hrs/OT pass through; enter the $ deduction &amp; earning lines in OnPay separately — its total should match Final Total.</div>}

      <CCKpiStrip items={[
        { icon: '👥', label: 'Employees', value: loading ? '…' : filtered.length, tone: 'blue' },
        { icon: '⏱️', label: 'Regular hours', value: loading ? '…' : T.reg.toLocaleString(), tone: 'green' },
        { icon: '⚡', label: 'OT hours', value: loading ? '…' : T.ot.toLocaleString(), tone: 'amber', delta: '@ 1.5×' },
        { icon: '💵', label: 'Gross (Final Total)', value: loading ? '…' : money(T.final), tone: 'violet' },
        { icon: '➖', label: 'Net deductions', value: loading ? '…' : money(-(T.tolls + T.ded)), tone: 'red', delta: 'tolls + other' },
      ]} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        {!finalized && <CCBtn variant="secondary" style={{ fontSize: 12 }} onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'syncRoster', weekId: data.week.id }) }); load(week); }}>＋ Sync roster (add new hires)</CCBtn>}
        {saving && <span style={{ fontSize: 12, color: cc.muted }}>Saving…</span>}
        <div style={{ marginLeft: 'auto', minWidth: 220 }}><CCSearchBox value={search} onChange={setSearch} placeholder="Search name…" /></div>
      </div>

      <div style={{ background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: 14, overflow: 'auto', maxHeight: '64vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1400 }}>
          <thead><tr>
            <th style={thL}>Role</th><th style={thL}>Name</th><th style={th}>Rate</th>
            <th style={th}>Reg Hrs</th><th style={th}>OT Hrs</th><th style={th}>Reg Total</th><th style={th}>OT Total</th>
            <th style={th}>Tolls</th><th style={th}>Other Deduct</th><th style={th}>Other Earn</th><th style={th}>Commissions</th><th style={th}>Bonus</th>
            <th style={th}>Final Total</th><th style={th}>OnPay Hrs</th><th style={th}>OnPay OT</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={15} style={{ ...td, textAlign: 'center', color: cc.faint, padding: 30 }}>Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={15} style={{ ...td, textAlign: 'center', color: cc.faint, padding: 30 }}>No employees.</td></tr>
                : filtered.map(en => {
                  const c = calc(en);
                  return <tr key={en.id}>
                    <td style={tdL}>{en.roleCode ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: roleTone(en.roleCode), color: roleFg(en.roleCode) }}>{en.roleCode}</span> : '—'}</td>
                    <td style={{ ...tdL, fontWeight: 600, color: cc.ink }}>{en.name}</td>
                    <td style={{ ...td, color: cc.muted }}>{money(en.rate)}</td>
                    <td style={td}>{num(en, 'regularHours', 54)}</td>
                    <td style={td}>{num(en, 'otHours', 48, 'ot')}</td>
                    <td style={{ ...td, color: cc.ink2 }}>{money(c.regTotal)}</td>
                    <td style={{ ...td, color: cc.amber }}>{c.otTotal ? money(c.otTotal) : '—'}</td>
                    <td style={td}>{num(en, 'tolls', 68, 'ded')}</td>
                    <td style={td}>{num(en, 'otherDeductions', 68, 'ded')}</td>
                    <td style={td}>{num(en, 'otherEarnings', 68, 'ern')}</td>
                    <td style={td}>{num(en, 'commissions', 68, 'ern')}</td>
                    <td style={td}>{num(en, 'bonus', 68, 'ern')}</td>
                    <td style={{ ...td, fontWeight: 700, color: cc.ink }}>{money(c.finalTotal)}</td>
                    <td style={{ ...td, fontWeight: 700, color: cc.green }}>{Number(en.regularHours) || 0}</td>
                    <td style={{ ...td, fontWeight: 700, color: cc.amber }}>{Number(en.otHours) || '—'}</td>
                  </tr>;
                })}
          </tbody>
          {!loading && filtered.length > 0 && <tfoot><tr>
            <td style={{ ...tdL, padding: '11px 9px', borderTop: `2px solid ${cc.line2}`, background: cc.panel2 }}></td>
            <td style={{ ...tdL, padding: '11px 9px', borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>TOTALS</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2 }}></td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>{T.reg}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.amber }}>{T.ot}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>{money(T.regT)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.amber }}>{money(T.otT)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.red }}>{money(T.tolls)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.red }}>{money(T.ded)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.green }}>{money(T.earn)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.green }}>{money(T.comm)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.green }}>{money(T.bonus)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>{money(T.final)}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.green }}>{T.reg}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.amber }}>{T.ot}</td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

// Simple export (full tracker view). The OnPay-format CSV is a later step.
function exportOnpay(rows: any[], calc: (en: any) => any) {
  const headers = ['Role', 'Name', 'Rate', 'Reg Hrs', 'OT Hrs', 'Reg Total', 'OT Total', 'Tolls', 'Other Deductions', 'Other Earnings', 'Commissions', 'Bonus', 'Final Total', 'OnPay Hrs', 'OnPay OT'];
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map(en => { const c = calc(en); return [en.roleCode || '', en.name, en.rate, en.regularHours || 0, en.otHours || 0, c.regTotal.toFixed(2), c.otTotal.toFixed(2), en.tolls || 0, en.otherDeductions || 0, en.otherEarnings || 0, en.commissions || 0, en.bonus || 0, c.finalTotal.toFixed(2), en.regularHours || 0, en.otHours || 0].map(esc).join(','); });
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'payroll-tracker.csv'; a.click(); URL.revokeObjectURL(url);
}
