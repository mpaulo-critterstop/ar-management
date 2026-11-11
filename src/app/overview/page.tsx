'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import CommandShell from '@/components/CommandShell';
import { canAccessModule } from '@/lib/access';

// Command Center "Overview" — the redesigned Hub home. Highlights (wins) -> Needs attention (issues) ->
// module grid. Wired to the real KPI endpoints the old home already used (/api/kpi, /api/leads, /api/dispatch,
// /api/dialpad/calls). New route alongside the existing home so nothing breaks while we evaluate.

const C = {
  panel: '#1E1E23', panel2: '#26262C', ink: '#ECEAE3', muted: '#9A988E', faint: '#6A685F', line: '#2D2D33',
  blue: '#5B9BE0', green: '#3FAE8C', amber: '#D79A4A', red: '#E07A7A',
};
const money = (n: number) => '$' + Math.round(n).toLocaleString();
const moneyK = (n: number) => n >= 1000 ? '$' + (n / 1000).toFixed(0) + 'k' : '$' + Math.round(n).toLocaleString();

export default function OverviewPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const user = session?.user as any;
  const [kpi, setKpi] = useState<any>(null);
  const [leads, setLeads] = useState<any>(null);
  const [dispatch, setDispatch] = useState<any>(null);
  const [dialpad, setDialpad] = useState<any>(null);

  useEffect(() => {
    fetch('/api/kpi').then(r => r.ok ? r.json() : null).then(setKpi).catch(() => {});
    fetch('/api/leads').then(r => r.ok ? r.json() : null).then(setLeads).catch(() => {});
    fetch('/api/dispatch').then(r => r.ok ? r.json() : null).then(setDispatch).catch(() => {});
    fetch('/api/dialpad/calls?range=month').then(r => r.ok ? r.json() : null).then(setDialpad).catch(() => {});
  }, []);

  const can = (m: string) => canAccessModule(user, m as any);
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const name = (user?.name || user?.username || '').split(' ')[0] || '';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // --- real metrics with graceful fallbacks ---
  const leadsTotal = leads?.kpis?.total;
  const leadsConv = leads?.kpis?.conversionRate;
  const dispTotal = dispatch?.kpis?.total;
  const dispAttn = dispatch?.kpis?.needsAttention;
  const dispExcl = dispatch?.kpis?.exclusionPending;
  const openAR = kpi?.totalAR;
  const overdueAR = kpi?.overdueAR;
  const collRate = kpi?.collectionRate != null ? Math.round(kpi.collectionRate * 100) : null;
  const dpTotal = dialpad?.stats?.total ?? dialpad?.total;
  const dpAnswered = dialpad?.stats?.answered ?? dialpad?.answered;
  const answerRate = (dpTotal && dpAnswered != null) ? Math.round((dpAnswered / dpTotal) * 100) : null;

  // Highlights = the wins (good numbers). Only show tiles the user can see + that have data.
  const highlights = [
    can('leads') && leadsTotal != null ? { icon: '🎯', label: 'Leads Tracker', value: leadsTotal, note: leadsConv != null ? `${leadsConv.toFixed(1)}% close rate` : 'leads this month' } : null,
    answerRate != null && can('dialpad') ? { icon: '📞', label: 'Answer rate', value: answerRate + '%', note: answerRate >= 90 ? 'above 90% target' : 'this month' } : null,
    can('ar') && collRate != null ? { icon: '💰', label: 'Collection rate', value: collRate + '%', note: 'last 30 days' } : null,
  ].filter(Boolean) as any[];

  // Needs attention = the issues (only if the user can act on them)
  const attention = [
    can('dispatch') && dispAttn ? { icon: '📊', title: 'Jobs need attention', sub: 'stale or 3+ trap checks', n: dispAttn, href: '/dispatch', red: false } : null,
    can('ar') && overdueAR ? { icon: '💰', title: 'Overdue A/R', sub: 'past-due balances', n: moneyK(overdueAR), href: '/accounts-receivable', red: true } : null,
    can('dispatch') && dispExcl ? { icon: '🚪', title: 'Exclusion pending', sub: 'jobs awaiting exclusion', n: dispExcl, href: '/dispatch', red: false } : null,
  ].filter(Boolean) as any[];

  // Module cards (grouped) — each with its live headline stat where available
  const opsCards = [
    can('dispatch') && { icon: '🚚', nm: 'Dispatcher', ds: 'Active exclusion jobs, trap checks, FAR, close-outs.', big: dispTotal ?? '—', sl: 'active jobs', chg: dispAttn ? `${dispAttn} need attn` : '', href: '/dispatch' },
    can('ar') && { icon: '💰', nm: 'Accounts Receivable', ds: 'Collections, SCC, dunning, payment follow-up.', big: openAR != null ? moneyK(openAR) : '—', sl: 'open A/R', chg: '', href: '/accounts-receivable' },
    can('leads') && { icon: '🎯', nm: 'Leads Tracker', ds: 'Wildlife inspection leads, PM performance, conversion.', big: leadsTotal ?? '—', sl: 'leads', chg: leadsConv != null ? `${leadsConv.toFixed(0)}% close` : '', href: '/leads' },
    can('dialpad') && { icon: '📞', nm: 'Dialpad Analytics', ds: 'Call volume, answer rate, missed & abandoned.', big: answerRate != null ? answerRate + '%' : '—', sl: 'answered', chg: '', href: '/calls' },
    can('helcim') && { icon: '💳', nm: 'Stax Payments', ds: 'Take payments, send links, refunds, declines.', big: '—', sl: 'payments', chg: '', href: '/stax' },
    can('exclusion-scheduling') && { icon: '🚪', nm: 'Exclusion Scheduling', ds: 'Estimated vs booked time, over/under flags.', big: dispExcl ?? '—', sl: 'pending', chg: '', href: '/exclusion-scheduling' },
    can('service-pool') && { icon: '🧹', nm: 'Job Pool', ds: 'Pest & termite subs due for service.', big: '—', sl: 'due', chg: '', href: '/service-pool' },
    can('lsa-leads') && { icon: '📣', nm: 'LSA Leads', ds: 'Google Local Services Ads with follow-up.', big: '—', sl: 'leads', chg: '', href: '/lsa-leads' },
    can('field-performance') && { icon: '⚡', nm: 'Field Effort Meter', ds: 'Tech effort, close-out, callback, reliability.', big: '—', sl: 'avg score', chg: '', href: '/field-performance' },
    can('pest-sales') && { icon: '🐀', nm: 'Pest Control Sales', ds: 'PM pest, rodent, termite sales + initial service.', big: '—', sl: 'sales', chg: '', href: '/pest-sales' },
    can('pest-inspections') && { icon: '🔍', nm: 'Pest Inspections', ds: 'Inspections per PM, sold/inspected, close rate.', big: '—', sl: 'close rate', chg: '', href: '/pest-inspections' },
    can('csr-pest-sales') && { icon: '📋', nm: 'CSR Pest Sales', ds: 'Pest/rodent/termite sales by CSRs.', big: '—', sl: 'sales', chg: '', href: '/csr-pest-sales' },
    can('cancellations') && { icon: '🚫', nm: 'Pest Cancellations', ds: 'Churn analysis + win-back list.', big: '—', sl: 'churn', chg: '', href: '/cancellations' },
    can('csr') && { icon: '📝', nm: 'CSR Leads Tracker', ds: 'CSR-sourced leads + conversion.', big: '—', sl: 'leads', chg: '', href: '/csr' },
  ].filter(Boolean) as any[];
  const mgmtCards = [
    can('payroll') && { icon: '🧾', nm: 'Payroll', ds: 'Commissions, hours, PTO, pay runs.', big: '—', sl: 'admin', chg: '', href: '/payroll' },
  ].filter(Boolean) as any[];
  const repCards = [
    can('reports') && { icon: '📈', nm: 'Reports', ds: 'Insulation, exclusion revenue, AR benchmark.', big: '—', sl: 'reports', chg: '', href: '/reports' },
  ].filter(Boolean) as any[];

  const Card = (m: any) => (
    <div key={m.nm} onClick={() => router.push(m.href)} style={st.mod}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.blue; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.line; (e.currentTarget as HTMLElement).style.transform = 'none'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={st.modIc}>{m.icon}</div><div style={{ fontSize: 14, fontWeight: 600 }}>{m.nm}</div>
      </div>
      <div style={st.modDs}>{m.ds}</div>
      <div style={st.modStat}>
        <div><span style={{ fontSize: 19, fontWeight: 600 }}>{m.big}</span> <span style={{ fontSize: 11, color: C.faint }}>{m.sl}</span></div>
        {m.chg ? <span style={{ fontSize: 11.5, fontWeight: 600, color: C.green }}>{m.chg}</span> : null}
      </div>
    </div>
  );

  const Section = (icon: string, title: string) => (
    <div style={st.secH}><span>{icon}</span> {title} <span style={st.secLn} /></div>
  );

  return (
    <CommandShell>
      <div style={st.top}>
        <div><div style={st.hello}>Overview</div><div style={st.helloSub}>{today} · {greeting}{name ? `, ${name}` : ''} 👋 — here's where things stand</div></div>
        {can('helcim') && <button onClick={() => router.push('/stax')} style={st.btnP}>+ Take Payment</button>}
      </div>

      {/* HIGHLIGHTS */}
      {highlights.length > 0 && <>
        {Section('✨', 'Highlights')}
        <div style={st.hero}>
          {highlights.map((h, i) => (
            <div key={i} style={{ ...st.hcard, borderLeft: `3px solid ${C.green}` }}>
              <div style={st.hlbl}>{h.icon} {h.label}</div>
              <div style={st.hval}>{h.value}</div>
              <div style={{ ...st.hd, color: C.green }}>▲ {h.note}</div>
            </div>
          ))}
        </div>
      </>}

      {/* NEEDS ATTENTION */}
      {attention.length > 0 && <>
        {Section('⚠️', 'Needs attention')}
        <div style={st.attnRow}>
          {attention.map((a, i) => (
            <div key={i} onClick={() => router.push(a.href)} style={{ ...st.attnC, borderLeftColor: a.red ? C.red : C.amber }}>
              <div style={st.attnTtl}>{a.icon} {a.title}</div>
              <div style={st.attnSub}>{a.sub}</div>
              <div style={{ ...st.attnN, color: a.red ? C.red : C.amber }}>{a.n}</div>
            </div>
          ))}
        </div>
      </>}

      {/* MODULES */}
      {opsCards.length > 0 && <>{Section('🛠️', 'Operations')}<div style={st.mods}>{opsCards.map(Card)}</div></>}
      {mgmtCards.length > 0 && <>{Section('💼', 'Management')}<div style={st.mods}>{mgmtCards.map(Card)}</div></>}
      {repCards.length > 0 && <>{Section('📈', 'Reports')}<div style={st.mods}>{repCards.map(Card)}</div></>}
    </CommandShell>
  );
}

const st: Record<string, React.CSSProperties> = {
  top: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  hello: { fontSize: 24, fontWeight: 600, letterSpacing: '-.01em', color: C.ink },
  helloSub: { fontSize: 13, color: C.muted, marginTop: 3 },
  btnP: { fontSize: 12.5, fontWeight: 600, padding: '9px 15px', borderRadius: 9, border: 'none', background: C.blue, color: '#0c1a2b', cursor: 'pointer' },
  secH: { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, margin: '24px 0 12px', display: 'flex', alignItems: 'center', gap: 10 },
  secLn: { flex: 1, height: 1, background: C.line },
  hero: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 },
  hcard: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13, padding: '15px 16px', boxShadow: '0 10px 34px rgba(0,0,0,.35)' },
  hlbl: { fontSize: 12, color: C.muted, fontWeight: 500 },
  hval: { fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', marginTop: 8, lineHeight: 1, color: C.ink },
  hd: { fontSize: 12, marginTop: 6 },
  attnRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 11 },
  attnC: { background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.amber}`, borderRadius: 11, padding: '12px 14px', cursor: 'pointer', boxShadow: '0 10px 34px rgba(0,0,0,.35)' },
  attnTtl: { fontSize: 13, fontWeight: 600, color: C.ink },
  attnSub: { fontSize: 12, color: C.muted, marginTop: 3 },
  attnN: { fontSize: 20, fontWeight: 600, marginTop: 6 },
  mods: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(228px,1fr))', gap: 12 },
  mod: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13, padding: 15, cursor: 'pointer', transition: 'border-color .15s, transform .15s', boxShadow: '0 10px 34px rgba(0,0,0,.35)' },
  modIc: { width: 34, height: 34, borderRadius: 9, background: C.panel2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 },
  modDs: { fontSize: 12, color: C.muted, marginTop: 9, lineHeight: 1.45, minHeight: 34 },
  modStat: { marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
};
