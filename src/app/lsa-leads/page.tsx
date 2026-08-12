'use client';
import { useEffect, useState } from 'react';

const STAGES = ['New', 'Awaiting Customer', 'Customer Replied', 'Need Follow-up', 'Booked', 'Lost'];
const stageColor: Record<string, { bg: string; fg: string }> = {
  'New': { bg: '#e6f0ff', fg: '#0052cc' },
  'Awaiting Customer': { bg: '#fef9e6', fg: '#a16207' },
  'Customer Replied': { bg: '#e6f7ff', fg: '#0891b2' },
  'Need Follow-up': { bg: '#fee2e2', fg: '#b91c1c' },
  'Booked': { bg: '#e6f9ec', fg: '#128a3f' },
  'Lost': { bg: '#f1efe8', fg: '#888780' },
  'Call — handled': { bg: '#f1efe8', fg: '#B4B2A9' },
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

  function load() {
    setLoading(true);
    fetch(`/api/lsa-leads?status=${encodeURIComponent(status)}&leadType=${encodeURIComponent(leadType)}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, leadType]);

  const [undoable, setUndoable] = useState<Record<string, string>>({}); // leadId -> prior status, during undo window

  async function tagLead(leadId: string, tag: 'Booked' | 'Lost', priorStatus: string) {
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

  const leads = (data?.leads || []).filter((l: any) =>
    !search || (l.contactName || '').toLowerCase().includes(search.toLowerCase())
    || (l.contactPhone || '').includes(search));

  // Pagination (client-side over filtered data).
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const pageLeads = leads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Reset to page 1 whenever filters/search change the result set out from under the current page.
  useEffect(() => { setPage(1); }, [status, leadType, search]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8', verticalAlign: 'top' };

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>LSA Leads</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>Google Local Services Ads leads. Stages update automatically from message activity — reply in LSA and it moves to Awaiting Customer; 2 days silent flips to Need Follow-up with a Slack alert. You can still override a stage manually.</p>
      </div>

      {/* Pipeline header */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        {STAGES.map(s => {
          const c = stageColor[s];
          const active = status === s;
          return (
            <button key={s} onClick={() => setStatus(active ? 'All' : s)}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 14px', borderRadius: 10, minWidth: 92,
                background: active ? c.bg : '#fff', border: `0.5px solid ${active ? c.fg : '#E8E7E3'}`, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: c.fg }}>{data?.byStage?.[s] ?? '—'}</span>
              <span style={{ fontSize: 11, color: '#888780' }}>{s}</span>
            </button>
          );
        })}
      </div>

      {/* Priority callout */}
      {data && (data.followupNeeded > 0 || data.messageOpen > 0) && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
          {data.followupNeeded > 0 && <span style={{ color: '#b91c1c' }}>🔴 <strong>{data.followupNeeded}</strong> need follow-up now</span>}
          {data.messageOpen > 0 && <span style={{ color: '#0891b2' }}>💬 <strong>{data.messageOpen}</strong> open message leads</span>}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
        <input type="text" placeholder="Search name/phone..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 180 }} />
        <select value={leadType} onChange={e => setLeadType(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All types</option>
          <option value="MESSAGE">Message</option>
          <option value="PHONE_CALL">Phone call</option>
          <option value="BOOKING">Booking</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="All">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Contact</th><th style={th}>Type</th><th style={th}>Last Message</th>
            <th style={th}>Received</th><th style={th}>Last Activity</th><th style={th}>Stage</th><th style={th}>Tag</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={7}>Loading…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={7}>No LSA leads for these filters. Run the sync to pull leads.</td></tr>
            ) : pageLeads.map((l: any) => {
              const isMsg = l.leadType === 'MESSAGE';
              return (
                <tr key={l.id} style={l.status === 'Need Follow-up' ? { background: '#fef6f6' } : undefined}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{l.contactName || <span style={{ color: '#B4B2A9' }}>Unknown</span>}</div>
                    {l.contactPhone && <div style={{ fontSize: 11, color: '#888780' }}>{l.contactPhone}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: isMsg ? '#e6f7ff' : '#f1efe8', color: isMsg ? '#0891b2' : '#6B6A64' }}>
                      {isMsg ? '💬 Message' : l.leadType === 'PHONE_CALL' ? '📞 Call' : l.leadType === 'BOOKING' ? '📅 Booking' : l.leadType}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 320, color: '#6B6A64' }}>{l.lastMessageText ? (l.lastMessageText.length > 120 ? l.lastMessageText.slice(0, 120) + '…' : l.lastMessageText) : '—'}</td>
                  <td style={{ ...td, color: '#6B6A64', whiteSpace: 'nowrap' }}>{fmtDate(l.creationDateTime)}</td>
                  <td style={{ ...td, color: '#6B6A64', whiteSpace: 'nowrap' }}>{fmtWhen(l.lastActivityAt)}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                      background: stageColor[l.status]?.bg || '#f1efe8', color: stageColor[l.status]?.fg || '#6B6A64', whiteSpace: 'nowrap' }}>
                      {l.status}
                    </span>
                  </td>
                  <td style={td}>
                    {l.leadType === 'PHONE_CALL' ? (
                      <span style={{ fontSize: 11, color: '#B4B2A9' }}>—</span>
                    ) : undoable[l.leadId] !== undefined ? (
                      <button onClick={() => untagLead(l.leadId)}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>
                        ↶ Undo
                      </button>
                    ) : (l.status === 'Booked' || l.status === 'Lost') ? (
                      // already tagged terminal — offer release back to automatic (only meaningful if manual)
                      l.manualOverride ? (
                        <button onClick={() => untagLead(l.leadId)}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#B4B2A9', cursor: 'pointer' }}>
                          × untag
                        </button>
                      ) : <span style={{ fontSize: 11, color: '#B4B2A9' }}>auto</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => tagLead(l.leadId, 'Booked', l.status)}
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #128a3f', background: '#e6f9ec', color: '#128a3f', cursor: 'pointer' }}>
                          ✓ Booked
                        </button>
                        <button onClick={() => tagLead(l.leadId, 'Lost', l.status)}
                          style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #B4B2A9', background: '#f1efe8', color: '#888780', cursor: 'pointer' }}>
                          ✕ Lost
                        </button>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#888780' }}>
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, leads.length)} of {leads.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage(1)} disabled={page === 1}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === 1 ? '#D3D1C7' : '#2C2C2A', cursor: page === 1 ? 'default' : 'pointer' }}>« First</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === 1 ? '#D3D1C7' : '#2C2C2A', cursor: page === 1 ? 'default' : 'pointer' }}>‹ Prev</button>
            <span style={{ padding: '0 8px' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === totalPages ? '#D3D1C7' : '#2C2C2A', cursor: page === totalPages ? 'default' : 'pointer' }}>Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', color: page === totalPages ? '#D3D1C7' : '#2C2C2A', cursor: page === totalPages ? 'default' : 'pointer' }}>Last »</button>
          </div>
        </div>
      )}
    </div>
  );
}
