'use client';
import { useEffect, useState } from 'react';

const STAGES = ['New', 'Replied', 'Awaiting Customer', 'Follow-up Needed', 'Booked', 'Lost'];
const stageColor: Record<string, { bg: string; fg: string }> = {
  'New': { bg: '#e6f0ff', fg: '#0052cc' },
  'Replied': { bg: '#e6f7ff', fg: '#0891b2' },
  'Awaiting Customer': { bg: '#fef9e6', fg: '#a16207' },
  'Follow-up Needed': { bg: '#fee2e2', fg: '#b91c1c' },
  'Booked': { bg: '#e6f9ec', fg: '#128a3f' },
  'Lost': { bg: '#f1efe8', fg: '#888780' },
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

  function load() {
    setLoading(true);
    fetch(`/api/lsa-leads?status=${encodeURIComponent(status)}&leadType=${encodeURIComponent(leadType)}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, leadType]);

  async function setLeadStatus(leadId: string, newStatus: string) {
    await fetch('/api/lsa-leads', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, status: newStatus }),
    });
    load();
  }

  const leads = (data?.leads || []).filter((l: any) =>
    !search || (l.contactName || '').toLowerCase().includes(search.toLowerCase())
    || (l.contactPhone || '').includes(search));

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8', verticalAlign: 'top' };

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>LSA Leads</h1>
        <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0' }}>Google Local Services Ads leads and follow-up tracking. Message leads that go quiet auto-flag for follow-up.</p>
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
            <th style={th}>Received</th><th style={th}>Last Activity</th><th style={th}>Stage</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={6}>Loading…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: '#888780', padding: 30 }} colSpan={6}>No LSA leads for these filters. Run the sync to pull leads.</td></tr>
            ) : leads.map((l: any) => {
              const isMsg = l.leadType === 'MESSAGE';
              return (
                <tr key={l.id} style={l.status === 'Follow-up Needed' ? { background: '#fef6f6' } : undefined}>
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
                    <select value={l.status} onChange={e => setLeadStatus(l.leadId, e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: `0.5px solid ${stageColor[l.status]?.fg || '#D3D1C7'}`,
                        background: stageColor[l.status]?.bg || '#fff', color: stageColor[l.status]?.fg || '#2C2C2A', fontWeight: 500, cursor: 'pointer' }}>
                      {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
