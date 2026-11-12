'use client';
import { useState, useEffect } from 'react';
import { PageHeader as CCPageHeader, SegTabs as CCSegTabs } from '@/components/cc/Layout';
import { Btn as CCBtn } from '@/components/cc/Primitives';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function CollectionsTracker({ embedded }: { embedded?: boolean }) {
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
  const th: React.CSSProperties = { textAlign: 'left', padding: '13px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#908E85', background: '#232329', borderBottom: '1px solid #2A2A30', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 };
  const td: React.CSSProperties = { textAlign: 'left', padding: '12px 16px', fontSize: 13, color: '#C9C7BF', borderBottom: '1px solid #2A2A30', whiteSpace: 'nowrap' };
  const btn = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 12, padding: '5px 11px', borderRadius: 7, border: '1px solid '+fg+'44', background: bg, color: fg, cursor: 'pointer', fontWeight: 600, marginRight: 5 });

  // countdown / flag cell
  function statusCell(row: any) {
    if (row.stage === 'SENT') {
      const bd = row.badDebtDueInDays;
      const armTag = row.track === 'COLLECTIONS' && row.armSubtype ? ` (${row.armSubtype === 'CONTINGENCY' ? 'Contingency' : 'Flat rate'})` : '';
      return <span style={{ fontSize: 12, color: '#908E85' }}>{row.track === 'SCC' ? 'SCC filed' : 'Sent to ARM'}{armTag} {fmt(row.sentAt)} · bad-debt in {bd}d</span>;
    }
    if (row.stage === 'BAD_DEBT_PROPOSED') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#361e1e', color: '#E57C7C', fontWeight: 600 }}>Bad Debt — pending approval</span>;
    if (row.stage === 'BAD_DEBT_APPROVED') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#232329', color: '#908E85' }}>Bad Debt approved {fmt(row.badDebtApprovedAt)}</span>;
    // countdown stages
    const d = row.daysLeft;
    if (row.actionDue) return <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#361e1e', color: '#E57C7C', fontWeight: 700 }}>⚑ 0 days — ACTION DUE</span>;
    if (row.finalWarning) return <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: '#FBF3E5', color: '#BA7517', fontWeight: 700 }}>⚠ {d}d left — final warning</span>;
    if (d === null || d === undefined) return <span style={{ fontSize: 12, color: '#63615A' }}>—</span>;
    return <span style={{ fontSize: 12, color: '#F0EEE8', fontWeight: 500 }}>{d} days left</span>;
  }

  function engagementCell(row: any) {
    if (row.stage === 'SENT' || row.stage.startsWith('BAD_DEBT')) return <span style={{ color: '#63615A', fontSize: 11 }}>—</span>;
    return (
      <span style={{ fontSize: 11 }}>
        {row.respondedAt ? <span style={{ color: '#5B9BE0' }}>Responded {fmt(row.respondedAt)}</span> : null}
        {row.respondedAt && row.promisedAt ? ' · ' : null}
        {row.promisedAt ? <span style={{ color: '#0F6E56' }}>Promised {fmt(row.promisedAt)}</span> : null}
        {!row.respondedAt && !row.promisedAt ? <span style={{ color: '#63615A' }}>no engagement</span> : null}
        {row.lastOutreachAt ? (
          <span style={{ display: 'block', color: '#908E85', marginTop: 2 }}>
            📞 Called {fmt(row.lastOutreachAt)}{row.outreachCount > 1 ? ` (${row.outreachCount}×)` : ''}
          </span>
        ) : null}
      </span>
    );
  }

  function actionsCell(row: any) {
    if (row.stage === 'BAD_DEBT_PROPOSED') return <button style={btn('#E57C7C', '#fff')} onClick={() => { if (confirm('Approve this as Bad Debt? (Admin only — does NOT write to FieldRoutes)')) act(row.id, 'approveBadDebt'); }}>Approve Bad Debt</button>;
    if (row.stage === 'BAD_DEBT_APPROVED' || row.stage === 'PAID') return null;
    if (row.stage === 'SENT') return <button style={btn('#232329', '#908E85')} onClick={() => setModal({ id: row.id, kind: 'partial', date: todayStr() })}>Log partial payment</button>;
    // countdown stages — engagement + final-call + send
    const els = [];
    if (!row.respondedAt) els.push(<button key="r" style={btn('#15263a', '#5B9BE0')} onClick={() => setModal({ id: row.id, kind: 'responded', date: todayStr() })}>Responded</button>);
    if (!row.promisedAt) els.push(<button key="p" style={btn('#143229', '#43B892')} onClick={() => setModal({ id: row.id, kind: 'promised', date: todayStr() })}>Promised to Pay</button>);
    els.push(<button key="pr" style={btn('#26262C', '#C9C7BF')} onClick={() => setModal({ id: row.id, kind: 'partial', date: todayStr() })}>Partial pmt</button>);
    if (row.actionDue) {
      if (!row.finalCallMadeAt) els.push(<button key="fc" style={btn('#352a16', '#DBA14E')} onClick={() => act(row.id, 'finalCall')}>✓ Final call made</button>);
      else {
        const armLabel = row.track === 'SCC' ? 'File SCC' : row.recommendedArm === 'CONTINGENCY' ? 'Send to ARM (Contingency)' : 'Send to ARM (Flat rate)';
        const confirmMsg = row.track === 'SCC' ? 'Mark SCC Filed?' : `Send to ARM as ${row.recommendedArm === 'CONTINGENCY' ? 'CONTINGENCY (No Recovery No Fee)' : 'FLAT RATE (uses a slot)'}?`;
        els.push(<button key="send" style={btn('#E57C7C', '#fff')} onClick={() => { if (confirm(confirmMsg)) act(row.id, row.track === 'SCC' ? 'sccFiled' : 'sentToARM'); }}>{armLabel}</button>);
      }
    }
    return <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{els}</span>;
  }

  const cfg = data?.config;
  const flagCount = data ? [...data.collections, ...data.scc].filter((r: any) => r.actionDue || r.finalWarning).length : 0;
  const bdCount = data ? data.badDebt.filter((r: any) => r.stage === 'BAD_DEBT_PROPOSED').length : 0;

  return (
    <div style={ embedded ? {} : { maxWidth: 1280, margin: '0 auto', padding: '30px 34px 70px' } }>
      {!embedded && <CCPageHeader icon="⚖️" title="Collections · Small Claims · Bad Debt" subtitle="Overdue invoices auto-enter by amount; 15-day countdown with engagement, then escalation."
        actions={<CCBtn variant="secondary" onClick={runSync} disabled={syncing} style={{ color: '#9D8BE6', borderColor: '#3a3357' }}>{syncing ? 'Syncing…' : '↻ Run sync now'}</CCBtn>} />}
      {embedded && <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:12 }}><CCBtn variant="secondary" onClick={runSync} disabled={syncing} style={{ color: '#9D8BE6', borderColor: '#3a3357' }}>{syncing ? 'Syncing…' : '↻ Run sync now'}</CCBtn></div>}
      <p style={{ fontSize: 12.5, color: '#908E85', margin: '-14px 0 10px', lineHeight: 1.6, maxWidth: 820 }}>
        {cfg ? `< ${money(cfg.amountCutoff)} → Collections, ≥ ${money(cfg.amountCutoff)} → SCC` : '…'}. Final-warning flag at {cfg?.finalWarningDaysLeft ?? 7}d left → action flag at 0. AR logs engagement to extend; one final call before action. Bad Debt is a proposal for approval — nothing writes to FieldRoutes automatically.
      </p>
      {flagCount > 0 && <p style={{ fontSize: 12.5, color: '#E57C7C', fontWeight: 600, margin: '0 0 14px' }}>⚑ {flagCount} row(s) need attention (final-warning or action-due)</p>}

      <div style={{ marginBottom: 18 }}>
        <CCSegTabs active={tab} onChange={(k:string)=>setTab(k as any)} tabs={[
          { key:'collections', label:'Collections', count: data?.collections.length ?? 0 },
          { key:'scc', label:'Small Claims', count: data?.scc.length ?? 0 },
          { key:'badDebt', label:`Bad Debt${bdCount ? ' ⚑'+bdCount : ''}`, count: data?.badDebt.length ?? 0 },
        ]} />
      </div>

      {loading ? <div style={{ color: '#908E85' }}>Loading…</div> : (
        <div style={{ border: '1px solid #2A2A30', borderRadius: 14, overflow: 'auto', maxHeight: '62vh', background: '#1C1C21' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Customer</th><th style={th}>Invoice</th><th style={th}>Office</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Due</th>
              <th style={th}>Status</th><th style={th}>Engagement</th><th style={th}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id} style={{ background: (row.actionDue || row.stage === 'BAD_DEBT_PROPOSED') ? '#361e1e' : row.finalWarning ? '#352a16' : undefined }}>
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
              {!rows.length && <tr><td colSpan={8} style={{ ...td, color: '#908E85', padding: 20 }}>Nothing in this tab.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* date-picker modal for Responded / Promised / Partial */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', zIndex: 50 }} onClick={() => setModal(null)}>
          <div style={{ background: '#1C1C21', border: '1px solid #35353C', borderRadius: 14, padding: 22, width: 380, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F0EEE8', marginBottom: 6 }}>
              {modal.kind === 'responded' ? 'Customer responded' : modal.kind === 'promised' ? 'Customer promised to pay' : 'Log partial payment'}
            </div>
            <div style={{ fontSize: 13, color: '#908E85', marginBottom: 14 }}>
              {modal.kind === 'partial' ? 'Resets the 15-day countdown from the payment date and re-enables engagement.' : 'Pick the ACTUAL date it happened (not today, if it was earlier). The countdown extends from this date.'}
            </div>
            <label style={{ fontSize: 12, color: '#908E85' }}>Date<input type="date" value={modal.date} max={todayStr()} onChange={e => setModal({ ...modal, date: e.target.value })} style={{ display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #35353C', marginTop: 4, boxSizing: 'border-box', background: '#26262C', color: '#F0EEE8' }} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => setModal(null)} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { const { id, kind, date } = modal; setModal(null); act(id, kind === 'responded' ? 'logResponded' : kind === 'promised' ? 'logPromised' : 'partialReset', { date }); }} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: 'none', background: '#5B9BE0', color: '#1C1C21', fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
