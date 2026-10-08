'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function CollectionsTrackerPage() {
  const [tab, setTab] = useState<'collections' | 'scc' | 'badDebt'>('collections');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState<any>(null); // { id, kind: 'responded'|'promised'|'partial', date }

  const load = () => fetch('/api/ar/collections').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function act(id: string, action: string, extra: any = {}) {
    const r = await fetch('/api/ar/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, ...extra }) });
    const j = await r.json();
    if (j.error) { alert(j.error); return; }
    load();
  }
  async function runSync() { setSyncing(true); await fetch('/api/cron/collections-sync?token=critterstop2026').catch(() => {}); setSyncing(false); load(); }

  const rows = data ? (tab === 'collections' ? data.collections : tab === 'scc' ? data.scc : data.badDebt) : [];
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '9px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: 'none', background: bg, color: fg, cursor: 'pointer', fontWeight: 500, marginRight: 4 });

  // countdown / flag cell
  function statusCell(row: any) {
    if (row.stage === 'SENT') {
      const bd = row.badDebtDueInDays;
      const armTag = row.track === 'COLLECTIONS' && row.armSubtype ? ` (${row.armSubtype === 'CONTINGENCY' ? 'Contingency' : 'Flat rate'})` : '';
      return <span style={{ fontSize: 12, color: '#888780' }}>{row.track === 'SCC' ? 'SCC filed' : 'Sent to ARM'}{armTag} {fmt(row.sentAt)} · bad-debt in {bd}d</span>;
    }
    if (row.stage === 'BAD_DEBT_PROPOSED') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#FCEBEB', color: '#b91c1c', fontWeight: 600 }}>Bad Debt — pending approval</span>;
    if (row.stage === 'BAD_DEBT_APPROVED') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#EFEDE6', color: '#64748b' }}>Bad Debt approved {fmt(row.badDebtApprovedAt)}</span>;
    // countdown stages
    const d = row.daysLeft;
    if (row.actionDue) return <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#FCEBEB', color: '#b91c1c', fontWeight: 700 }}>⚑ 0 days — ACTION DUE</span>;
    if (row.finalWarning) return <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#FBF3E5', color: '#BA7517', fontWeight: 700 }}>⚠ {d}d left — final warning</span>;
    return <span style={{ fontSize: 12, color: '#2C2C2A', fontWeight: 500 }}>{d} days left</span>;
  }

  function engagementCell(row: any) {
    if (row.stage === 'SENT' || row.stage.startsWith('BAD_DEBT')) return <span style={{ color: '#B4B2A9', fontSize: 11 }}>—</span>;
    return (
      <span style={{ fontSize: 11 }}>
        {row.respondedAt ? <span style={{ color: '#185FA5' }}>Responded {fmt(row.respondedAt)}</span> : null}
        {row.respondedAt && row.promisedAt ? ' · ' : null}
        {row.promisedAt ? <span style={{ color: '#0F6E56' }}>Promised {fmt(row.promisedAt)}</span> : null}
        {!row.respondedAt && !row.promisedAt ? <span style={{ color: '#B4B2A9' }}>no engagement</span> : null}
      </span>
    );
  }

  function actionsCell(row: any) {
    if (row.stage === 'BAD_DEBT_PROPOSED') return <button style={btn('#b91c1c', '#fff')} onClick={() => { if (confirm('Approve this as Bad Debt? (Admin only — does NOT write to FieldRoutes)')) act(row.id, 'approveBadDebt'); }}>Approve Bad Debt</button>;
    if (row.stage === 'BAD_DEBT_APPROVED' || row.stage === 'PAID') return null;
    if (row.stage === 'SENT') return <button style={btn('#EFEDE6', '#64748b')} onClick={() => setModal({ id: row.id, kind: 'partial', date: todayStr() })}>Log partial payment</button>;
    // countdown stages — engagement + final-call + send
    const els = [];
    if (!row.respondedAt) els.push(<button key="r" style={btn('#E6F1FB', '#185FA5')} onClick={() => setModal({ id: row.id, kind: 'responded', date: todayStr() })}>Responded</button>);
    if (!row.promisedAt) els.push(<button key="p" style={btn('#E1F5EE', '#0F6E56')} onClick={() => setModal({ id: row.id, kind: 'promised', date: todayStr() })}>Promised to Pay</button>);
    els.push(<button key="pr" style={btn('#F1EFE8', '#888780')} onClick={() => setModal({ id: row.id, kind: 'partial', date: todayStr() })}>Partial pmt</button>);
    if (row.actionDue) {
      if (!row.finalCallMadeAt) els.push(<button key="fc" style={btn('#FBF3E5', '#BA7517')} onClick={() => act(row.id, 'finalCall')}>✓ Final call made</button>);
      else {
        const armLabel = row.track === 'SCC' ? 'File SCC' : row.recommendedArm === 'CONTINGENCY' ? 'Send to ARM (Contingency)' : 'Send to ARM (Flat rate)';
        const confirmMsg = row.track === 'SCC' ? 'Mark SCC Filed?' : `Send to ARM as ${row.recommendedArm === 'CONTINGENCY' ? 'CONTINGENCY (No Recovery No Fee)' : 'FLAT RATE (uses a slot)'}?`;
        els.push(<button key="send" style={btn('#b91c1c', '#fff')} onClick={() => { if (confirm(confirmMsg)) act(row.id, row.track === 'SCC' ? 'sccFiled' : 'sentToARM'); }}>{armLabel}</button>);
      }
    }
    return <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{els}</span>;
  }

  const cfg = data?.config;
  const flagCount = data ? [...data.collections, ...data.scc].filter((r: any) => r.actionDue || r.finalWarning).length : 0;
  const bdCount = data ? data.badDebt.filter((r: any) => r.stage === 'BAD_DEBT_PROPOSED').length : 0;

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/g/operations" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Operations</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Collections · Small Claims · Bad Debt</h1>
        <button onClick={runSync} disabled={syncing} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: syncing ? 'wait' : 'pointer' }}>{syncing ? 'Syncing…' : '↻ Run sync now'}</button>
      </div>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 6px', lineHeight: 1.6 }}>
        Overdue invoices auto-enter by amount ({cfg ? `< ${money(cfg.amountCutoff)} → Collections, ≥ ${money(cfg.amountCutoff)} → SCC` : '…'}). 15-day countdown → final-warning flag at {cfg?.finalWarningDaysLeft ?? 7}d left → action flag at 0. AR logs engagement to extend; one final call before action. Bad Debt is a proposal for approval — nothing writes to FieldRoutes automatically.
      </p>
      {flagCount > 0 && <p style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, margin: '0 0 14px' }}>⚑ {flagCount} row(s) need attention (final-warning or action-due)</p>}

      <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 18 }}>
        {([['collections', `Collections (${data?.collections.length ?? 0})`], ['scc', `Small Claims (${data?.scc.length ?? 0})`], ['badDebt', `Bad Debt${bdCount ? ' ⚑' + bdCount : ''} (${data?.badDebt.length ?? 0})`]] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as any)} style={{ fontSize: 13, padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#2C2C2A' : '#888780', fontWeight: tab === t ? 600 : 400 }}>{label}</button>
        ))}
      </div>

      {loading ? <div style={{ color: '#888780' }}>Loading…</div> : (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Customer</th><th style={th}>Invoice</th><th style={th}>Office</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Due</th>
              <th style={th}>Status</th><th style={th}>Engagement</th><th style={th}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id} style={{ background: (row.actionDue || row.stage === 'BAD_DEBT_PROPOSED') ? '#FDF6F6' : row.finalWarning ? '#FDFAF2' : undefined }}>
                  <td style={{ ...td, fontWeight: 600 }}>{row.customerName || '—'}</td>
                  <td style={td}>#{row.invoiceNumber || '—'}</td>
                  <td style={td}>{row.office || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(row.amount)}</td>
                  <td style={td}>{fmt(row.dueDate)}</td>
                  <td style={td}>{statusCell(row)}</td>
                  <td style={td}>{engagementCell(row)}</td>
                  <td style={td}>{actionsCell(row)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ ...td, color: '#888780', padding: 20 }}>Nothing in this tab.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* date-picker modal for Responded / Promised / Partial */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setModal(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 360, maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#2C2C2A', marginBottom: 6 }}>
              {modal.kind === 'responded' ? 'Customer responded' : modal.kind === 'promised' ? 'Customer promised to pay' : 'Log partial payment'}
            </div>
            <div style={{ fontSize: 13, color: '#888780', marginBottom: 14 }}>
              {modal.kind === 'partial' ? 'Resets the 15-day countdown from the payment date and re-enables engagement.' : 'Pick the ACTUAL date it happened (not today, if it was earlier). The countdown extends from this date.'}
            </div>
            <label style={{ fontSize: 12, color: '#888780' }}>Date<input type="date" value={modal.date} max={todayStr()} onChange={e => setModal({ ...modal, date: e.target.value })} style={{ display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', marginTop: 4, boxSizing: 'border-box' }} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => setModal(null)} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { const { id, kind, date } = modal; setModal(null); act(id, kind === 'responded' ? 'logResponded' : kind === 'promised' ? 'logPromised' : 'partialReset', { date }); }} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
