'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleString() : '—';

const method = (m: number) => ({ 1: 'Cash', 2: 'Check', 3: 'Card', 4: 'ACH' } as any)[m] || m;

export default function HelcimPaymentsPage() {
  const [tab, setTab] = useState<'send' | 'links' | 'report'>('send');
  const [report, setReport] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [office, setOffice] = useState('DFW');
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [delivery, setDelivery] = useState('email');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [links, setLinks] = useState<any[]>([]);

  const loadLinks = () => fetch('/api/stax/payment-link').then(r => r.json()).then(d => setLinks(d.links || [])).catch(() => {});
  const loadReport = () => fetch('/api/stax/status').then(r => r.json()).then(setReport).catch(() => {});
  useEffect(() => { loadLinks(); loadReport(); }, []);
  // "Sync statuses" → checks each pending link's Stax invoice and flips Sent → Paid when paid. (The webhook
  // already records payments to FR; this keeps the Payment Links status column current.)
  async function runSync() {
    setSyncing(true);
    try { await fetch('/api/stax/payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reconcile' }) }); } catch {}
    setSyncing(false); loadLinks(); loadReport();
  }

  async function send() {
    setErr(''); setResult(null);
    if (!invoice.trim() || !amount || parseFloat(amount) <= 0) { setErr('Enter an invoice # and a positive amount.'); return; }
    setSending(true);
    try {
      const r = await fetch('/api/stax/payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', office, invoiceNumber: invoice.trim(), amount: parseFloat(amount), delivery }) });
      const d = await r.json();
      if (d.error) { setErr(d.error); setSending(false); return; }
      setResult(d); loadLinks();
    } catch { setErr('Something went wrong.'); }
    setSending(false);
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  // Centered variants (aligned columns for the tabs).
  const thC: React.CSSProperties = { ...th, textAlign: 'center' };
  const tdC: React.CSSProperties = { ...td, textAlign: 'center' };
  const thR: React.CSSProperties = { ...th, textAlign: 'right' };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', marginTop: 4, boxSizing: 'border-box' };
  const statusPill = (s: string) => { const c: any = { sent: ['#FBF3E5', '#BA7517'], viewed: ['#E6F1FB', '#185FA5'], paid: ['#E1F5EE', '#0F6E56'], expired: ['#F1EFE8', '#888780'] }; const [bg, fg] = c[s] || c.expired; return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: bg, color: fg }}>{s}</span>; };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>💳 Stax Payments</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>Send a customer a payment link for a specific invoice. Payments record back into FieldRoutes automatically.</p>

      <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 24 }}>
        {(['send', 'links', 'report'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#2C2C2A' : '#888780', fontWeight: tab === t ? 600 : 400 }}>{t === 'send' ? 'Send Payment Link' : t === 'links' ? `Payment Links (${links.length})` : 'Payment Report'}</button>
        ))}
      </div>

      {tab === 'send' && (
        <div style={{ maxWidth: 440 }}>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 20, background: '#fff' }}>
            <label style={{ fontSize: 12, color: '#888780' }}>Office<select value={office} onChange={e => setOffice(e.target.value)} style={inp}><option>DFW</option><option>ATX</option><option>OKC</option><option>CStat</option></select></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>FieldRoutes Invoice #<input value={invoice} onChange={e => setInvoice(e.target.value)} placeholder="272858" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>Amount to collect<input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="158.25" style={inp} /><span style={{ fontSize: 11, color: '#B4B2A9' }}>Enter a partial amount for deposits (e.g. 50%).</span></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>Delivery<select value={delivery} onChange={e => setDelivery(e.target.value)} style={inp}><option value="email">Email</option><option value="text">Text</option></select></label>
            <button onClick={send} disabled={sending} style={{ width: '100%', marginTop: 18, fontSize: 14, padding: '12px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: sending ? 'wait' : 'pointer' }}>{sending ? 'Generating…' : 'Generate & Send Payment Link'}</button>
            {err && <div style={{ fontSize: 13, color: '#b91c1c', background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>{err}</div>}
          </div>

          {result && (
            <div style={{ border: '0.5px solid #9FE1CB', borderRadius: 12, padding: 16, background: '#E1F5EE', marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F6E56', marginBottom: 8 }}>✓ Payment link created for {result.invoice?.customer}</div>
              <div style={{ fontSize: 12, color: '#2C2C2A', marginBottom: 4 }}>Invoice balance: {money(parseFloat(result.invoice?.balance || 0))} · {result.delivery === 'text' ? `Phone: ${result.invoice?.phone || '—'}` : `Email: ${result.invoice?.email || '—'}`}</div>
              <div style={{ fontSize: 12, marginBottom: 8, color: result.sent ? '#0F6E56' : '#BA7517' }}>
                {result.sent ? `✓ ${result.delivery === 'text' ? 'Texted to ' + result.invoice?.phone : 'Emailed to ' + result.invoice?.email}` : `⚠ Not sent (${result.sendReason || 'unknown'}) — copy the link below and send manually.`}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input readOnly value={result.url} style={{ flex: 1, fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #9FE1CB', background: '#fff' }} />
                <button onClick={() => navigator.clipboard.writeText(result.url)} style={{ fontSize: 12, padding: '8px 14px', borderRadius: 6, border: 'none', background: '#0F6E56', color: '#fff', cursor: 'pointer' }}>Copy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'links' && (<>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={runSync} disabled={syncing} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: syncing ? 'wait' : 'pointer' }}>{syncing ? 'Syncing…' : '↻ Sync statuses'}</button>
        </div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thC}>Created</th><th style={thC}>Customer</th><th style={thC}>Invoice #</th><th style={thR}>Amount</th><th style={thC}>Status</th><th style={thC}>Via</th><th style={thC}>By</th><th style={thC}>Link</th></tr></thead>
            <tbody>
              {links.map(l => (
                <tr key={l.id}>
                  <td style={tdC}>{fmt(l.createdAt)}</td>
                  <td style={tdC}>{l.customerName || '—'}</td>
                  <td style={tdC}>{l.frInvoiceNumber}</td>
                  <td style={tdR}>{money(l.amount)}</td>
                  <td style={tdC}>{statusPill(l.status)}</td>
                  <td style={tdC}>{l.deliveryMethod}</td>
                  <td style={tdC}>{l.createdBy || '—'}</td>
                  <td style={tdC}><button onClick={() => navigator.clipboard.writeText(l.url)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#185FA5', cursor: 'pointer' }}>Copy</button></td>
                </tr>
              ))}
              {!links.length && <tr><td colSpan={8} style={{ ...tdC, color: '#888780', padding: 20 }}>No payment links yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === 'report' && report && (() => {
        const s = report.summary || {};
        const card = (label: string, key: string, color: string) => (
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: '#fff', minWidth: 110 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{s[key]?.count ?? 0}</div>
            <div style={{ fontSize: 11, color: '#888780' }}>{label}</div>
            <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{money(s[key]?.total ?? 0)}</div>
          </div>
        );
        const attention = report.attention || [];
        return (<>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            {card('Written', 'written', '#128a3f')}{card('Flagged', 'flagged', s.flagged?.count ? '#b91c1c' : '#888780')}{card('Failed', 'failed', s.failed?.count ? '#b91c1c' : '#888780')}{card('Skipped', 'skipped', '#888780')}{card('Pending', 'pending', '#BA7517')}
          </div>
          {attention.length > 0 && (<>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#b91c1c', marginBottom: 8 }}>⚠ Needs attention ({attention.length})</div>
            <div style={{ border: '0.5px solid #F7C1C1', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 24 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Invoice #</th><th style={thC}>Status</th><th style={thC}>Reason</th></tr></thead>
                <tbody>{attention.map((r: any) => (<tr key={r.id}><td style={tdC}>{r.staxTransactionId}</td><td style={tdR}>{money(r.amount)}</td><td style={tdC}>{r.frInvoiceNumber || '—'}</td><td style={tdC}>{r.status}</td><td style={{ ...tdC, whiteSpace: 'normal', maxWidth: 320 }}>{r.failReason || '—'}</td></tr>))}</tbody>
              </table>
            </div>
          </>)}
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>Recent recorded payments</div>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Office</th><th style={thC}>Invoice #</th><th style={thC}>FR Payment</th><th style={thC}>Method</th><th style={thC}>Via</th><th style={thC}>When</th></tr></thead>
              <tbody>
                {(report.recentWritten || []).map((r: any) => (<tr key={r.staxTransactionId}><td style={tdC}>{r.staxTransactionId}</td><td style={tdR}>{money(r.amount)}</td><td style={tdC}>{r.office || '—'}</td><td style={tdC}>{r.frInvoiceNumber || '—'}</td><td style={tdC}>{r.frPaymentId || '—'}</td><td style={tdC}>{method(r.frPaymentMethod)}</td><td style={tdC}>{r.source}</td><td style={tdC}>{fmt(r.processedAt)}</td></tr>))}
                {!report.recentWritten?.length && <tr><td colSpan={8} style={{ ...tdC, color: '#888780', padding: 16 }}>No payments recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>);
      })()}
    </div>
  );
}
