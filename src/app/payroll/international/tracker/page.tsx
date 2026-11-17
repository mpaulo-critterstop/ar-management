'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, SearchBox as CCSearchBox } from '@/components/cc/Layout';
import { Btn as CCBtn } from '@/components/cc/Primitives';
import { cc } from '@/components/cc/tokens';

const curSym = (c?: string) => c === 'PHP' ? '₱' : '$';
const money = (n: number | null | undefined, c?: string) => n == null ? '—' : curSym(c) + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function recentWeeks(): string[] {
  const out: string[] = []; const d = new Date();
  const dow = d.getDay(); d.setDate(d.getDate() - ((dow + 6) % 7)); // Monday
  for (let i = 0; i < 16; i++) { out.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() - 7); }
  return out;
}
const fmtWeek = (s: string) => { const [y, m, d] = s.split('-').map(Number); const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${MON[m - 1]} ${d}, ${y}`; };

export default function IntlPayrollTrackerPage() {
  const [dbWeeks, setDbWeeks] = useState<{ date: string; status: string }[]>([]);
  const weekOptions = (() => {
    const map = new Map<string, string>();
    for (const w of dbWeeks) map.set(w.date, w.status);
    for (const w of recentWeeks().slice(0, 2)) if (!map.has(w)) map.set(w, 'new');
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, status]) => ({ date, status }));
  })();
  const [week, setWeek] = useState(recentWeeks()[0]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [usdRate, setUsdRate] = useState<string>('');
  const [didInit, setDidInit] = useState(false);

  const load = useCallback(async (w: string) => {
    setLoading(true); setEdits({});
    const res = await fetch(`/api/payroll/tracker?week=${w}&region=International`).catch(() => null);
    if (res?.ok) { const d = await res.json(); setData(d); setUsdRate(d.week?.usdRate != null ? String(d.week.usdRate) : ''); }
    setLoading(false);
  }, []);
  useEffect(() => { load(week); }, [week, load]);

  useEffect(() => {
    fetch('/api/payroll/tracker?list=1&region=International').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.weeks?.length) {
        const list = d.weeks.map((w: any) => ({ date: new Date(w.weekDate).toISOString().split('T')[0], status: w.status }));
        setDbWeeks(list);
        if (!didInit) { const newest = list.map((w: any) => w.date).sort().reverse()[0]; if (newest) setWeek(newest); setDidInit(true); }
      }
    }).catch(() => {});
  }, []);

  const entries: any[] = data?.entries || [];
  const finalized = data?.week?.status === 'finalized';
  const merged = entries.map(en => ({ ...en, ...(edits[en.id] || {}) }));
  const rate = Number(usdRate) || 0;

  const calc = (en: any) => {
    const r = Number(en.rate) || 0, reg = Number(en.regularHours) || 0, ot = Number(en.otHours) || 0;
    const regTotal = en.otTotalOverride != null && en.backfilled ? r * reg : r * reg;
    const otTotal = en.otTotalOverride != null ? Number(en.otTotalOverride) : r * 1.5 * ot;
    const localTotal = regTotal + otTotal;
    const usdTotal = en.usdTotalOverride != null ? Number(en.usdTotalOverride) : (en.currency === 'PHP' ? (rate ? localTotal / rate : null) : localTotal);
    return { regTotal, otTotal, usdTotal };
  };

  const filtered = merged.filter(en => !search.trim() || en.name.toLowerCase().includes(search.trim().toLowerCase()));
  const T = filtered.reduce((a, en) => { const c = calc(en); a.reg += Number(en.regularHours) || 0; a.ot += Number(en.otHours) || 0; a.usd += c.usdTotal || 0; return a; }, { reg: 0, ot: 0, usd: 0 });

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
  async function saveRate(v: string) {
    setUsdRate(v);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveRate', weekId: data.week.id, usdRate: v }) }).catch(() => {});
    }, 700);
  }

  const th: React.CSSProperties = { textAlign: 'right', padding: '9px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: cc.muted, background: cc.panel2, borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 };
  const thL = { ...th, textAlign: 'left' as const };
  const td: React.CSSProperties = { padding: '6px 10px', borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: cc.ink2 };
  const tdL = { ...td, textAlign: 'left' as const };
  const inp = (w: number, kind?: 'ot'): React.CSSProperties => ({ width: w, background: cc.panel2, border: `1px solid ${kind === 'ot' ? '#4a3a1e' : cc.line2}`, borderRadius: 6, padding: '5px 7px', color: kind === 'ot' ? cc.amber : cc.ink, fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' });

  function num(en: any, field: string, w: number, kind?: 'ot') {
    return <input disabled={finalized} value={en[field] ?? ''} onChange={e => edit(en.id, field, e.target.value)} style={{ ...inp(w, kind), opacity: finalized ? 0.6 : 1 }} />;
  }

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '30px 34px 70px' }}>
      <Link href="/payroll/international" style={{ fontSize: 13, color: cc.muted, textDecoration: 'none', display: 'inline-block', marginBottom: 6 }}>↩ International Payroll</Link>
      <CCPageHeader icon="🌏" title="International Payroll Tracker" subtitle="Enter hours & OT per employee — totals in local currency + converted to USD"
        actions={<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={week} onChange={e => setWeek(e.target.value)} style={{ fontSize: 13, padding: '9px 13px', borderRadius: 10, border: `1px solid ${cc.line2}`, background: cc.panel2, color: cc.ink }}>
            {weekOptions.map((w, i) => <option key={w.date} value={w.date}>Week of {fmtWeek(w.date)}{i === 0 ? ' (current)' : w.status === 'finalized' ? ' ✓' : ''}</option>)}
          </select>
          <CCBtn variant="secondary" onClick={() => exportCsv(filtered, calc)}>⇪ Export</CCBtn>
          {finalized
            ? <CCBtn variant="secondary" onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', weekId: data.week.id }) }); load(week); }}>↺ Reopen</CCBtn>
            : <CCBtn variant="primary" onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'finalize', weekId: data.week.id }) }); load(week); }}>✓ Finalize week</CCBtn>}
        </div>} />

      {finalized && <div style={{ background: cc.greenbg, border: '1px solid #2e5a4c', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: cc.green, marginBottom: 14 }}>✓ This week is finalized (read-only). Reopen to edit.</div>}

      {/* USD exchange rate + KPIs */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: 12, padding: '10px 14px' }}>
          <span style={{ fontSize: 12.5, color: cc.muted, fontWeight: 600 }}>₱ → $ rate</span>
          <span style={{ fontSize: 13, color: cc.muted }}>1 USD =</span>
          <input disabled={finalized} value={usdRate} onChange={e => saveRate(e.target.value)} placeholder="58.00" style={{ width: 80, background: cc.panel2, border: `1px solid ${cc.line2}`, borderRadius: 8, padding: '7px 10px', color: cc.ink, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
          <span style={{ fontSize: 13, color: cc.muted }}>PHP</span>
        </div>
        {!rate && <span style={{ fontSize: 12, color: cc.amber }}>⚠ Enter the exchange rate to compute USD totals for PHP employees.</span>}
      </div>

      <CCKpiStrip items={[
        { icon: '👥', label: 'Employees', value: loading ? '…' : filtered.length, tone: 'blue' },
        { icon: '⏱️', label: 'Regular hours', value: loading ? '…' : T.reg.toLocaleString(), tone: 'green' },
        { icon: '⚡', label: 'OT hours', value: loading ? '…' : T.ot.toLocaleString(), tone: 'amber', delta: '@ 1.5×' },
        { icon: '💵', label: 'Total (USD)', value: loading ? '…' : '$' + T.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tone: 'violet' },
      ]} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        {!finalized && <CCBtn variant="secondary" style={{ fontSize: 12 }} onClick={async () => { await fetch('/api/payroll/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'syncRoster', weekId: data.week.id }) }); load(week); }}>＋ Sync roster</CCBtn>}
        {saving && <span style={{ fontSize: 12, color: cc.muted }}>Saving…</span>}
        <div style={{ marginLeft: 'auto', minWidth: 220 }}><CCSearchBox value={search} onChange={setSearch} placeholder="Search name…" /></div>
      </div>

      <div style={{ background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: 14, overflow: 'auto', maxHeight: '64vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1200 }}>
          <thead><tr>
            <th style={thL}>Name</th><th style={th}>Rate</th><th style={th}>Hours</th><th style={th}>OT Hours</th>
            <th style={th}>Currency</th><th style={th}>Reg Total</th><th style={th}>OT Total</th><th style={th}>USD Total</th>
            <th style={thL}>Frequency &amp; Platform</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: cc.faint, padding: 30 }}>Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: cc.faint, padding: 30 }}>No employees.</td></tr>
                : filtered.map(en => {
                  const c = calc(en);
                  return <tr key={en.id}>
                    <td style={{ ...tdL, fontWeight: 600, color: cc.ink }}>{en.name}</td>
                    <td style={{ ...td, color: cc.muted }}>{money(en.rate, en.currency)}</td>
                    <td style={td}>{num(en, 'regularHours', 54)}</td>
                    <td style={td}>{num(en, 'otHours', 48, 'ot')}</td>
                    <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: en.currency === 'PHP' ? cc.violetbg : cc.panel2, color: en.currency === 'PHP' ? cc.violet : cc.muted }}>{en.currency}</span></td>
                    <td style={{ ...td, color: cc.ink2 }}>{money(c.regTotal, en.currency)}</td>
                    <td style={{ ...td, color: cc.amber }}>{c.otTotal ? money(c.otTotal, en.currency) : '—'}</td>
                    <td style={{ ...td, fontWeight: 700, color: cc.green }}>{c.usdTotal != null ? '$' + c.usdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    <td style={{ ...tdL, color: cc.ink2, fontSize: 12 }}>{en.payrollSchedule || <span style={{ color: cc.faint }}>—</span>}</td>
                  </tr>;
                })}
          </tbody>
          {!loading && filtered.length > 0 && <tfoot><tr>
            <td style={{ ...tdL, padding: '11px 10px', borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>TOTALS</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2 }}></td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.ink }}>{T.reg}</td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.amber }}>{T.ot}</td>
            <td colSpan={3} style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2 }}></td>
            <td style={{ ...td, borderTop: `2px solid ${cc.line2}`, background: cc.panel2, fontWeight: 700, color: cc.green }}>${T.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style={{ ...tdL, borderTop: `2px solid ${cc.line2}`, background: cc.panel2 }}></td>
          </tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

function exportCsv(rows: any[], calc: (en: any) => any) {
  const headers = ['Name', 'Rate', 'Hours', 'OT Hours', 'Currency', 'Reg Total', 'OT Total', 'USD Total', 'Frequency & Platform'];
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map(en => { const c = calc(en); return [en.name, en.rate, en.regularHours || 0, en.otHours || 0, en.currency, c.regTotal.toFixed(2), c.otTotal.toFixed(2), c.usdTotal != null ? c.usdTotal.toFixed(2) : '', en.payrollSchedule || ''].map(esc).join(','); });
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'intl-payroll-tracker.csv'; a.click(); URL.revokeObjectURL(url);
}
