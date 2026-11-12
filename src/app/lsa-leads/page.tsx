'use client';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, DataTable as CCDataTable, SearchBox as CCSearchBox, CustomerCell as CCCustomerCell, FilterChips as CCFilterChips } from '@/components/cc/Layout';
import { StatusPill as CCStatusPill } from '@/components/cc/Primitives';
import { useEffect, useState } from 'react';
import LagReportView from './LagReportView';

// Feature flag: LSA → Pest AI manual send. Hidden for now — most LSA leads have no valid phone/email, and
// Pest AI can't create a contact without one. Flip to true to re-enable the button + "Sent to Pest AI" tile.
// (Backend action + status + column all remain intact.)
const PESTAI_SEND_ENABLED = false;

const STAGES = PESTAI_SEND_ENABLED
  ? ['New', 'Awaiting Customer', 'Customer Replied', 'Need Follow-up', 'Moved to DialPad', 'Sent to Pest AI', 'Booked', 'Lost']
  : ['New', 'Awaiting Customer', 'Customer Replied', 'Need Follow-up', 'Moved to DialPad', 'Booked', 'Lost'];
const stageColor: Record<string, { bg: string; fg: string }> = {
  'New': { bg: '#e6f0ff', fg: '#5B9BE0' },
  'Awaiting Customer': { bg: '#fef9e6', fg: '#a16207' },
  'Customer Replied': { bg: '#15263a', fg: '#5B9BE0' },
  'Need Follow-up': { bg: '#fee2e2', fg: '#E57C7C' },
  'Moved to DialPad': { bg: '#e0f2f1', fg: '#0d7a6f' },
  'Sent to Pest AI': { bg: '#ede9fb', fg: '#6D28D9' },
  'Booked': { bg: '#143229', fg: '#43B892' },
  'Lost': { bg: '#232329', fg: '#908E85' },
  'Call — handled': { bg: '#232329', fg: '#63615A' },
};
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtWhen = (d: string | null) => {
  if (!d) return '—';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
};

export default function LsaLeadsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [leadType, setLeadType] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [location, setLocation] = useState('All');
  const [tab, setTab] = useState<'leads' | 'report'>('leads');

  function load() {
    setLoading(true);
    fetch(`/api/lsa-leads?status=${encodeURIComponent(status)}&leadType=${encodeURIComponent(leadType)}&location=${encodeURIComponent(location)}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, leadType, location]);

  const [undoable, setUndoable] = useState<Record<string, string>>({}); // leadId -> prior status, during undo window
  const [sending, setSending] = useState<Record<string, boolean>>({}); // leadId -> true while sending to Pest AI
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function tagLead(leadId: string, tag: 'Booked' | 'Lost' | 'Moved to DialPad', priorStatus: string) {
    await fetch('/api/lsa-leads', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, action: 'tag', tag }),
    });
    // open a ~10s undo window
    setUndoable(u => ({ ...u, [leadId]: priorStatus }));
    setTimeout(() => setUndoable(u => { const n = { ...u }; delete n[leadId]; return n; }), 10000);
    load();
  }

  async function untagLead(leadId: string) {
    await fetch('/api/lsa-leads', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, action: 'untag' }),
    });
    setUndoable(u => { const n = { ...u }; delete n[leadId]; return n; });
    load();
  }

  async function sendToPestAI(leadId: string) {
    if (!confirm('Send this lead to Pest AI? This fires the follow-up webhook for this lead.')) return;
    setSending(s => ({ ...s, [leadId]: true }));
    try {
      const res = await fetch('/api/lsa-leads', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, action: 'send-pestai' }),
      });
      const d = await res.json();
      if (!res.ok) { alert(d.error || 'Failed to send to Pest AI'); }
      load();
    } catch { alert('Failed to send to Pest AI'); }
    finally { setSending(s => { const n = { ...s }; delete n[leadId]; return n; }); }
  }

  const leads = (data?.leads || []).filter((l: any) =>
    !search || (l.contactName || '').toLowerCase().includes(search.toLowerCase())
    || (l.contactPhone || '').includes(search)
    || (l.leadId || '').includes(search));

  // Pagination (client-side over filtered data).
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const pageLeads = leads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Reset to page 1 whenever filters/search change the result set out from under the current page.
  useEffect(() => { setPage(1); }, [status, leadType, search]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '1px solid #2A2A30', textTransform: 'uppercase', letterSpacing: '.04em', background: '#232329', position: 'sticky', top: 0, zIndex: 2 };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#F0EEE8', borderBottom: '0.5px solid #232329', verticalAlign: 'top' };

  return (
    <div style={{ padding: '30px 34px 70px', maxWidth: 1400, margin: '0 auto' }}>
      <CCPageHeader icon="📣" title="LSA Leads" subtitle="Google Local Services Ads leads — stages auto-update from message activity" />

      {/* Location selector — 'All' aggregates every office; or pick one */}
      <div style={{ display: 'inline-flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        {['All', ...(data?.locations || ['Southlake'])].map((loc: string) => (
          <button key={loc} onClick={() => setLocation(loc)}
            style={{ fontSize: 12.5, padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontWeight: 600,
              border: `1px solid ${location === loc ? '#5B9BE0' : '#2A2A30'}`, background: location === loc ? '#15263a' : '#1C1C21', color: location === loc ? '#5B9BE0' : '#908E85' }}>
            {loc}
          </button>
        ))}
      </div>

      {/* Tabs: Leads tracker vs. Lag Report (both scoped to the selected location) */}
      <div style={{ display: 'flex', gap: 24, marginTop: 20, borderBottom: '0.5px solid #2A2A30' }}>
        {([['leads', 'Leads'], ['report', 'Lag Report']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontSize: 14, fontWeight: tab === k ? 600 : 400, color: tab === k ? '#F0EEE8' : '#908E85',
              background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? '#F0EEE8' : 'transparent'}`,
              padding: '0 0 10px', marginBottom: -0.5, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'report' ? (
        <div style={{ marginTop: 16 }}><LagReportView location={location} /></div>
      ) : (
      <>
      {/* Pipeline stages as filter chips */}
      <div style={{ marginTop: 16 }}>
        <CCFilterChips
          active={status}
          onChange={(k: string) => setStatus(k === status ? 'All' : k)}
          chips={STAGES.map((s: string) => {
            const t: any = s === 'Lost' ? 'red' : s === 'Booked' ? 'green' : s === 'Need Follow-up' ? 'amber' : s === 'Customer Replied' ? 'blue' : 'neutral';
            return { key: s, label: s, value: data?.byStage?.[s] ?? '—', valueTone: t };
          })}
        />
      </div>

      {/* Priority callout */}
      {data && (data.followupNeeded > 0 || data.messageOpen > 0) && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
          {data.followupNeeded > 0 && <span style={{ color: '#E57C7C' }}>🔴 <strong>{data.followupNeeded}</strong> need follow-up now</span>}
          {data.messageOpen > 0 && <span style={{ color: '#5B9BE0' }}>💬 <strong>{data.messageOpen}</strong> open message leads</span>}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={leadType} onChange={e => setLeadType(e.target.value)} style={{ fontSize: 12.5, padding: '8px 11px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8' }}>
          <option value="All">All types</option>
          <option value="MESSAGE">Message</option>
          <option value="PHONE_CALL">Phone call</option>
          <option value="BOOKING">Booking</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ fontSize: 12.5, padding: '8px 11px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8' }}>
          <option value="All">All stages</option>
          {STAGES.map((s: string) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', minWidth: 220 }}><CCSearchBox value={search} onChange={setSearch} placeholder="Search name / phone…" /></div>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid #2A2A30', borderRadius: 14, overflow: 'auto', maxHeight: '60vh', background: '#1C1C21', scrollbarGutter: 'stable' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Lead ID</th><th style={th}>Contact</th><th style={th}>Type</th><th style={th}>Last Message</th>
            <th style={th}>Received</th><th style={th}>Last Activity</th><th style={th}>Stage</th><th style={th}>Tag</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#908E85', padding: 30 }} colSpan={8}>Loading…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#908E85', padding: 30 }} colSpan={8}>No LSA leads for these filters. Run the sync to pull leads.</td></tr>
            ) : pageLeads.map((l: any) => {
              const isMsg = l.leadType === 'MESSAGE';
              return (
                <tr key={l.id} style={l.status === 'Need Follow-up' ? { background: '#2a1e1e' } : undefined}>
                  <td style={td}>
                    <button title="Click to copy Lead ID" onClick={() => { navigator.clipboard?.writeText(l.leadId); setCopiedId(l.leadId); setTimeout(() => setCopiedId(c => c === l.leadId ? null : c), 1500); }}
                      style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: copiedId === l.leadId ? '#43B892' : '#C9C7BF', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                      {copiedId === l.leadId ? '✓ copied' : l.leadId}
                    </button>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{l.contactName || <span style={{ color: '#63615A' }}>Unknown</span>}</div>
                    {l.contactPhone && <div style={{ fontSize: 11, color: '#908E85' }}>{l.contactPhone}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: isMsg ? '#15263a' : '#232329', color: isMsg ? '#5B9BE0' : '#C9C7BF' }}>
                      {isMsg ? '💬 Message' : l.leadType === 'PHONE_CALL' ? '📞 Call' : l.leadType === 'BOOKING' ? '📅 Booking' : l.leadType}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 320, color: '#C9C7BF' }}>{l.lastMessageText ? (l.lastMessageText.length > 120 ? l.lastMessageText.slice(0, 120) + '…' : l.lastMessageText) : '—'}</td>
                  <td style={{ ...td, color: '#C9C7BF', whiteSpace: 'nowrap' }}>{fmtDate(l.creationDateTime)}</td>
                  <td style={{ ...td, color: '#C9C7BF', whiteSpace: 'nowrap' }}>{fmtWhen(l.lastActivityAt)}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                      background: stageColor[l.status]?.bg || '#232329', color: stageColor[l.status]?.fg || '#C9C7BF', whiteSpace: 'nowrap' }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={td}>
                    {l.leadType === 'PHONE_CALL' ? (
                      <span style={{ fontSize: 11, color: '#63615A' }}>—</span>
                    ) : undoable[l.leadId] !== undefined ? (
                      <button onClick={() => untagLead(l.leadId)}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>
                        ↶ Undo
                      </button>
                    ) : (PESTAI_SEND_ENABLED && l.status === 'Sent to Pest AI') ? (
                      // Already sent to Pest AI — button greyed/disabled; offer release back to automatic.
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button disabled title={l.pestAiSentAt ? `Sent ${new Date(l.pestAiSentAt).toLocaleString()}` : 'Sent to Pest AI'}
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#232329', color: '#63615A', cursor: 'not-allowed' }}>
                          ✓ Sent to Pest AI
                        </button>
                        <button onClick={() => untagLead(l.leadId)}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#63615A', cursor: 'pointer' }}>
                          × untag
                        </button>
                      </div>
                    ) : (l.status === 'Booked' || l.status === 'Lost' || l.status === 'Moved to DialPad') ? (
                      // already tagged terminal — offer release back to automatic (only meaningful if manual)
                      l.manualOverride ? (
                        <button onClick={() => untagLead(l.leadId)}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#63615A', cursor: 'pointer' }}>
                          × untag
                        </button>
                      ) : <span style={{ fontSize: 11, color: '#63615A' }}>auto</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button onClick={() => tagLead(l.leadId, 'Booked', l.status)}
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #43B892', background: '#143229', color: '#43B892', cursor: 'pointer' }}>
                          ✓ Booked
                        </button>
                        <button onClick={() => tagLead(l.leadId, 'Lost', l.status)}
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #63615A', background: '#232329', color: '#908E85', cursor: 'pointer' }}>
                          ✕ Lost
                        </button>
                        <button onClick={() => tagLead(l.leadId, 'Moved to DialPad', l.status)} title="Lead gave a phone # but went quiet in LSA — continue follow-ups in DialPad"
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #0d7a6f', background: '#e0f2f1', color: '#0d7a6f', cursor: 'pointer' }}>
                          → DialPad
                        </button>
                        {PESTAI_SEND_ENABLED && (
                          <button onClick={() => sendToPestAI(l.leadId)} disabled={sending[l.leadId]} title={l.pestAiSentAt ? `Last sent ${new Date(l.pestAiSentAt).toLocaleString()}` : 'Send this lead to Pest AI'}
                            style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #6D28D9', background: l.pestAiSentAt ? '#f3f0fb' : '#ede9fb', color: '#6D28D9', cursor: sending[l.leadId] ? 'wait' : 'pointer', opacity: sending[l.leadId] ? 0.6 : 1 }}>
                            {sending[l.leadId] ? 'Sending…' : l.pestAiSentAt ? '↻ Pest AI' : '→ Pest AI'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && leads.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#908E85' }}>
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, leads.length)} of {leads.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage(1)} disabled={page === 1}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: page === 1 ? '#2A2A30' : '#F0EEE8', cursor: page === 1 ? 'default' : 'pointer' }}>« First</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: page === 1 ? '#2A2A30' : '#F0EEE8', cursor: page === 1 ? 'default' : 'pointer' }}>‹ Prev</button>
            <span style={{ padding: '0 8px' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: page === totalPages ? '#2A2A30' : '#F0EEE8', cursor: page === totalPages ? 'default' : 'pointer' }}>Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', color: page === totalPages ? '#2A2A30' : '#F0EEE8', cursor: page === totalPages ? 'default' : 'pointer' }}>Last »</button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
