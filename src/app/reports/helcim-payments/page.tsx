'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleString() : '—';
const method = (m: number) => ({ 1: 'Cash', 2: 'Check', 3: 'Card', 4: 'ACH' } as any)[m] || m;

export default function PaymentBridgePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = () => { setLoading(true); fetch('/api/payroll/helcim-status').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  async function runPoll() {
    setSyncing(true);
    await fetch('/api/cron/helcim-sync?token=critterstop2026').catch(() => {});
    setSyncing(false); load();
  }

  const s = data?.summary || {};
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };

  const statCard = (label: string, key: string, color: string) => (
    <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: '#fff', minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{s[key]?.count ?? 0}</div>
      <div style={{ fontSize: 11, color: '#888780' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{money(s[key]?.total ?? 0)}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: "#888780", textDecoration: "none" }}>← Reports</a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Helcim Payment Report</h1>
        <button onClick={runPoll} disabled={syncing} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: syncing ? 'wait' : 'pointer' }}>{syncing ? 'Syncing…' : '↻ Run sync now'}</button>
      </div>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>Helcim payments recorded into FieldRoutes. Webhook posts in real time; the sync is the safety net. Flagged/failed need attention.</p>

      {loading ? <div style={{ color: '#888780' }}>Loading…</div> : (<>
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {statCard('Written', 'written', '#128a3f')}
          {statCard('Flagged', 'flagged', (s.flagged?.count ? '#b91c1c' : '#888780'))}
          {statCard('Failed', 'failed', (s.failed?.count ? '#b91c1c' : '#888780'))}
          {statCard('Skipped', 'skipped', '#888780')}
          {statCard('Pending', 'pending', '#BA7517')}
        </div>

        {/* Heartbeats */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', fontSize: 12, color: '#888780' }}>
          <div style={{ flex: 1, minWidth: 260, border: '0.5px solid #E8E7E3', borderRadius: 8, padding: '10px 12px', background: '#fff' }}><b style={{ color: '#2C2C2A' }}>Last webhook:</b> {data.webhookLast || 'none yet'}</div>
          <div style={{ flex: 1, minWidth: 260, border: '0.5px solid #E8E7E3', borderRadius: 8, padding: '10px 12px', background: '#fff' }}><b style={{ color: '#2C2C2A' }}>Last sync:</b> {data.pollStatus || 'none yet'}</div>
        </div>

        {/* Attention queue */}
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: (data.attentionCount ? '#b91c1c' : '#2C2C2A') }}>⚠ Needs attention ({data.attentionCount})</div>
        <div style={{ border: '0.5px solid ' + (data.attentionCount ? '#F7C1C1' : '#E8E7E3'), borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 28 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Helcim Txn</th><th style={th}>Amount</th><th style={th}>Invoice #</th><th style={th}>Status</th><th style={th}>Reason</th><th style={th}>When</th></tr></thead>
            <tbody>
              {(data.attention || []).map((r: any) => (
                <tr key={r.id}>
                  <td style={td}>{r.helcimTransactionId}</td>
                  <td style={td}>{money(r.amount)}</td>
                  <td style={td}>{r.helcimInvoiceNumber || '—'}</td>
                  <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#FCEBEB', color: '#b91c1c' }}>{r.status}</span></td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 320 }}>{r.failReason || '—'}</td>
                  <td style={td}>{fmt(r.createdAt)}</td>
                </tr>
              ))}
              {!data.attention?.length && <tr><td colSpan={6} style={{ ...td, color: '#128a3f', padding: 16 }}>✓ Nothing needs attention — all payments matched and recorded.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Recent written */}
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Recent recorded payments</div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Helcim Txn</th><th style={th}>Amount</th><th style={th}>Office</th><th style={th}>Invoice #</th><th style={th}>FR Payment</th><th style={th}>Method</th><th style={th}>Via</th><th style={th}>When</th></tr></thead>
            <tbody>
              {(data.recentWritten || []).map((r: any) => (
                <tr key={r.helcimTransactionId}>
                  <td style={td}>{r.helcimTransactionId}</td>
                  <td style={td}>{money(r.amount)}</td>
                  <td style={td}>{r.office || '—'}</td>
                  <td style={td}>{r.helcimInvoiceNumber || '—'}</td>
                  <td style={td}>{r.frPaymentId || '—'}</td>
                  <td style={td}>{method(r.frPaymentMethod)}</td>
                  <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: r.source === 'webhook' ? '#E6F1FB' : '#F1EFE8', color: r.source === 'webhook' ? '#185FA5' : '#888780' }}>{r.source}</span></td>
                  <td style={td}>{fmt(r.processedAt)}</td>
                </tr>
              ))}
              {!data.recentWritten?.length && <tr><td colSpan={8} style={{ ...td, color: '#888780', padding: 16 }}>No payments recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
