'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleString() : '—';
const method = (m: number) => ({ 1: 'Cash', 2: 'Check', 3: 'Card', 4: 'ACH' } as any)[m] || m;

export default function StaxPaymentsPage() {
  const [tab, setTab] = useState<'links' | 'report'>('links');
  const [report, setReport] = useState<any>(null);
  const [office, setOffice] = useState('DFW');
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [delivery, setDelivery] = useState('email');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [links, setLinks] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [refundModal, setRefundModal] = useState<any>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  async function doRefund(full: boolean) {
    if (!refundModal) return;
    setRefunding(true);
    try {
      const bodyObj: any = { action: 'refund', staxTransactionId: refundModal.txnId, invoiceNumber: refundModal.invoice };
      if (!full && refundAmt) bodyObj.total = parseFloat(refundAmt);
      const r = await fetch('/api/stax/payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) });
      const j = await r.json();
      if (j.error || j.ok === false) { alert('Refund failed: ' + (j.error || j.status || 'unknown')); }
      else { alert('Refund successful: $' + (j.refundAmount || refundModal.amount) + (j.frPaymentId ? ' (recorded to FR)' : ' (Stax only — FR not matched)')); loadReport(); }
    } catch (e: any) { alert('Refund error: ' + String(e).slice(0,120)); }
    setRefunding(false); setRefundModal(null); setRefundAmt('');
  }

  const loadLinks = () => fetch('/api/stax/payment-link').then(r => r.json()).then(d => setLinks(d.links || [])).catch(() => {});
  const loadReport = () => fetch('/api/stax/status').then(r => r.json()).then(setReport).catch(() => {});
  useEffect(() => { loadLinks(); loadReport(); }, []);

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
  function openModal() { setModalOpen(true); setResult(null); setErr(''); setInvoice(''); setAmount(''); }

  const thC: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0, zIndex: 1 };
  const tdC: React.CSSProperties = { textAlign: 'center', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const thR: React.CSSProperties = { ...thC, textAlign: 'right' };
  const tdR: React.CSSProperties = { ...tdC, textAlign: 'right' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', marginTop: 4, boxSizing: 'border-box' };
  const statusPill = (s: string) => { const c: any = { sent: ['#FBF3E5', '#BA7517'], viewed: ['#E6F1FB', '#185FA5'], paid: ['#E1F5EE', '#0F6E56'], expired: ['#F1EFE8', '#888780'] }; const [bg, fg] = c[s] || c.expired; return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: bg, color: fg }}>{s}</span>; };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>💳 Stax Payments</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>Send a customer a payment link for a specific invoice. Payments record back into FieldRoutes automatically.</p>

      <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 24 }}>
        {(['links', 'report'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#2C2C2A' : '#888780', fontWeight: tab === t ? 600 : 400 }}>{t === 'links' ? `Payment Links (${links.length})` : 'Payment Report'}</button>
        ))}
      </div>

      {tab === 'links' && (() => {
        const q = linkSearch.trim().toLowerCase();
        const filteredLinks = q ? links.filter(l => (l.customerName || '').toLowerCase().includes(q) || String(l.frInvoiceNumber || '').toLowerCase().includes(q)) : links;
        return (<>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
          <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Search by customer name or invoice #…" style={{ flex: 1, maxWidth: 360, fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', boxSizing: 'border-box' }} />
          <button onClick={openModal} style={{ fontSize: 13, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Send Payment Link</button>
        </div>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thC}>Created</th><th style={thC}>Customer</th><th style={thC}>Invoice #</th><th style={thR}>Amount</th><th style={thC}>Status</th><th style={thC}>Via</th><th style={thC}>By</th><th style={thC}>Link</th></tr></thead>
              <tbody>
                {filteredLinks.map(l => (
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
                {!filteredLinks.length && <tr><td colSpan={8} style={{ ...tdC, color: '#888780', padding: 20 }}>{q ? 'No matches.' : 'No payment links yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>);
      })()}

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
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {card('Written', 'written', '#128a3f')}{card('Flagged', 'flagged', s.flagged?.count ? '#b91c1c' : '#888780')}{card('Failed', 'failed', s.failed?.count ? '#b91c1c' : '#888780')}{card('Skipped', 'skipped', '#888780')}{card('Pending', 'pending', '#BA7517')}
          </div>
          {attention.length > 0 && (<>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#b91c1c', marginBottom: 8 }}>⚠ Needs attention ({attention.length})</div>
            <div style={{ border: '0.5px solid #F7C1C1', borderRadius: 12, overflow: 'hidden', background: '#fff', marginBottom: 24 }}>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Invoice #</th><th style={thC}>Status</th><th style={thC}>Reason</th></tr></thead>
                  <tbody>{attention.map((r: any) => (<tr key={r.id}><td style={tdC}>{r.staxTransactionId}</td><td style={tdR}>{money(r.amount)}</td><td style={tdC}>{r.frInvoiceNumber || '—'}</td><td style={tdC}>{r.status}</td><td style={{ ...tdC, whiteSpace: 'normal', maxWidth: 320 }}>{r.failReason || '—'}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </>)}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Recent recorded payments</div>
            <input value={reportSearch} onChange={e => setReportSearch(e.target.value)} placeholder="Search by invoice #…" style={{ maxWidth: 240, fontSize: 13, padding: '8px 11px', borderRadius: 8, border: '0.5px solid #E8E7E3', boxSizing: 'border-box' }} />
          </div>
          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Office</th><th style={thC}>Invoice #</th><th style={thC}>FR Payment</th><th style={thC}>Method</th><th style={thC}>Via</th><th style={thC}>When</th><th style={thC}>Refund</th></tr></thead>
                <tbody>
                  {(report.recentWritten || []).filter((r: any) => { const q = reportSearch.trim().toLowerCase(); return !q || String(r.frInvoiceNumber || '').toLowerCase().includes(q); }).map((r: any) => (<tr key={r.staxTransactionId}><td style={tdC}>{r.staxTransactionId}</td><td style={tdR}>{money(r.amount)}</td><td style={tdC}>{r.office || '—'}</td><td style={tdC}>{r.frInvoiceNumber || '—'}</td><td style={tdC}>{r.frPaymentId || '—'}</td><td style={tdC}>{method(r.frPaymentMethod)}</td><td style={tdC}>{r.source}</td><td style={tdC}>{fmt(r.processedAt)}</td><td style={tdC}><button onClick={() => setRefundModal({ txnId: r.staxTransactionId, invoice: r.frInvoiceNumber, amount: r.amount })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Refund</button></td></tr>))}
                  {!report.recentWritten?.length && <tr><td colSpan={9} style={{ ...tdC, color: '#888780', padding: 16 }}>No payments recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>);
      })()}

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setModalOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#2C2C2A' }}>Send Payment Link</div>
              <button onClick={() => setModalOpen(false)} style={{ fontSize: 20, lineHeight: 1, border: 'none', background: 'transparent', color: '#888780', cursor: 'pointer' }}>×</button>
            </div>
            <label style={{ fontSize: 12, color: '#888780' }}>Office<select value={office} onChange={e => setOffice(e.target.value)} style={inp}><option>DFW</option><option>ATX</option><option>OKC</option><option>CStat</option></select></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>FieldRoutes Invoice #<input value={invoice} onChange={e => setInvoice(e.target.value)} placeholder="272858" style={inp} /></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>Amount to collect<input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="158.25" style={inp} /><span style={{ fontSize: 11, color: '#B4B2A9' }}>Enter a partial amount for deposits (e.g. 50%).</span></label>
            <label style={{ fontSize: 12, color: '#888780', display: 'block', marginTop: 14 }}>Delivery<select value={delivery} onChange={e => setDelivery(e.target.value)} style={inp}><option value="email">Email</option><option value="text">Text</option></select></label>
            <button onClick={send} disabled={sending} style={{ width: '100%', marginTop: 18, fontSize: 14, padding: '12px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: sending ? 'wait' : 'pointer' }}>{sending ? 'Generating…' : 'Generate & Send Payment Link'}</button>
            {err && <div style={{ fontSize: 13, color: '#b91c1c', background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>{err}</div>}

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
        </div>
      )}
      {refundModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setRefundModal(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '100%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#2C2C2A', marginBottom: 6 }}>Refund Payment</div>
            <div style={{ fontSize: 13, color: '#888780', marginBottom: 4 }}>Stax txn: {refundModal.txnId}</div>
            <div style={{ fontSize: 13, color: '#888780', marginBottom: 2 }}>Invoice: {refundModal.invoice || '—'} · Original: {money(refundModal.amount)}</div>
            <div style={{ fontSize: 12, color: '#B4B2A9', marginBottom: 16 }}>Voids if unsettled, refunds if settled. Records a negative payment back to the FieldRoutes invoice.</div>
            <label style={{ fontSize: 12, color: '#888780' }}>Partial amount (leave blank for full refund)<input type="number" step="0.01" value={refundAmt} onChange={e => setRefundAmt(e.target.value)} placeholder={`Full: ${money(refundModal.amount)}`} style={{ display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', marginTop: 4, boxSizing: 'border-box' }} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => setRefundModal(null)} style={{ flex: 1, fontSize: 13, padding: '11px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => doRefund(!refundAmt)} disabled={refunding} style={{ flex: 1.4, fontSize: 13, padding: '11px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 600, cursor: refunding ? 'wait' : 'pointer' }}>{refunding ? 'Processing…' : (refundAmt ? `Refund ${money(parseFloat(refundAmt) || 0)}` : 'Refund Full Amount')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
