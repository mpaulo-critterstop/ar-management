'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import BackButton from '@/components/BackButton';
import { canRefund } from '@/lib/access';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: any) => d ? new Date(d).toLocaleString() : '—';
const method = (m: number) => ({ 1: 'Cash', 2: 'Check', 3: 'Card', 4: 'ACH' } as any)[m] || m;

export default function StaxPaymentsPage() {
  const { data: session } = useSession();
  const allowRefund = canRefund(session?.user as any);
  const [tab, setTab] = useState<'links' | 'report' | 'onsite'>('links');
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
  const [reportStatus, setReportStatus] = useState<'recorded'|'refunded'|'flagged'|'failed'|'declined'|'pending'>('recorded');
  // Virtual terminal (Take Payment over the phone)
  const [vtOpen, setVtOpen] = useState(false);
  const [vtStep, setVtStep] = useState<'invoice'|'card'>('invoice');
  const [vtInvoice, setVtInvoice] = useState('');
  const [vtLookup, setVtLookup] = useState<any>(null);   // { customerName, office, balance, ... }
  const [vtAmount, setVtAmount] = useState('');
  const [vtBusy, setVtBusy] = useState(false);
  const [vtErr, setVtErr] = useState('');
  const [vtResult, setVtResult] = useState<any>(null);
  const [staxReady, setStaxReady] = useState(false);
  const [vtPayType, setVtPayType] = useState<'card'|'bank'>('card');
  const [vtRouting, setVtRouting] = useState('');
  const [vtAccount, setVtAccount] = useState('');
  const [vtBankType, setVtBankType] = useState<'checking'|'savings'>('checking');
  const [vtHolderType, setVtHolderType] = useState<'personal'|'business'>('personal');
  const [vtName, setVtName] = useState('');
  const [vtExpMonth, setVtExpMonth] = useState('');
  const [vtExpYear, setVtExpYear] = useState('');
  const [vtZip, setVtZip] = useState('');
  const fattRef = (globalThis as any);
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

  async function linkOnsite(staxTransactionId: string, suggested: string) {
    const invoiceNumber = window.prompt('Enter the FieldRoutes invoice # to link this payment to:', suggested || '');
    if (!invoiceNumber || !invoiceNumber.trim()) return;
    try {
      const r = await fetch('/api/stax/link-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staxTransactionId, invoiceNumber: invoiceNumber.trim() }) });
      const j = await r.json();
      if (j.ok && j.linked) { alert(`Linked to invoice #${invoiceNumber.trim()} and recorded to FieldRoutes.`); loadReport(); }
      else { alert('Could not link: ' + (j.error || 'unknown error') + '. The payment stays in Onsite Payments.'); loadReport(); }
    } catch (e) { alert('Link failed: ' + String(e)); }
  }
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

  // ---- Virtual Terminal (Take Payment) ----
  function openVt() {
    setVtOpen(true); setVtStep('invoice'); setVtInvoice(''); setVtLookup(null);
    setVtAmount(''); setVtErr(''); setVtResult(null);
    setVtName(''); setVtExpMonth(''); setVtExpYear(''); setVtZip('');
    setVtPayType('card'); setVtRouting(''); setVtAccount(''); setVtBankType('checking'); setVtHolderType('personal');
  }
  // Load Stax.js (Fattmerchant.js) once.
  useEffect(() => {
    if (!vtOpen || staxReady) return;
    if ((window as any).FattJs || (window as any).StaxJs) { setStaxReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://staxjs.staxpayments.com/stax.js';
    s.onload = () => setStaxReady(true);
    s.onerror = () => setVtErr('Could not load the secure card library. Check your connection and try again.');
    document.body.appendChild(s);
  }, [vtOpen, staxReady]);

  async function vtDoLookup() {
    setVtErr(''); setVtLookup(null);
    const inv = vtInvoice.trim();
    if (!inv) { setVtErr('Enter an invoice number.'); return; }
    setVtBusy(true);
    try {
      const r = await fetch(`/api/stax/invoice-lookup?invoice=${encodeURIComponent(inv)}`);
      const d = await r.json();
      if (!d.found) { setVtErr(d.error || 'Invoice not found.'); setVtBusy(false); return; }
      setVtLookup(d);
      setVtAmount(d.balance > 0 ? String(d.balance) : '');
      setVtName(d.customerName || '');
      setVtStep('card');
    } catch { setVtErr('Lookup failed. Try again.'); }
    setVtBusy(false);
  }

  // Create the Stax.js instance on the card step. For CARD, mount the secure iframe fields (number+CVV).
  // For BANK (ACH), we still need the instance for pay() but NOT the card iframe (bank fields are plain inputs).
  useEffect(() => {
    if (vtStep !== 'card' || !staxReady || !vtOpen) return;
    const token = process.env.NEXT_PUBLIC_STAX_WEB_TOKEN;
    if (!token) { setVtErr('Web Payments Token not configured.'); return; }
    const FattJsCtor = (window as any).FattJs || (window as any).StaxJs;
    if (!FattJsCtor) { setVtErr('Secure payment library not available.'); return; }
    const fattjs = new FattJsCtor(token, {
      number: { id: 'vt-card-number', placeholder: 'Card number', style: 'height:38px;width:100%;font-size:14px;padding:0 10px;' },
      cvv: { id: 'vt-card-cvv', placeholder: 'CVV', style: 'height:38px;width:100%;font-size:14px;text-align:center;padding:0 2px;box-sizing:border-box;' },
    });
    fattRef.__vtFatt = fattjs;
    if (vtPayType === 'card') fattjs.showCardForm().catch(() => setVtErr('Could not display the card form.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vtStep, staxReady, vtOpen, vtPayType]);

  async function vtCharge() {
    setVtErr(''); setVtResult(null);
    const amt = parseFloat(vtAmount);
    if (!amt || amt <= 0) { setVtErr('Enter a valid amount.'); return; }
    const fattjs = fattRef.__vtFatt;
    if (!fattjs) { setVtErr('Payment form not ready.'); return; }
    if (!vtName.trim()) { setVtErr('Enter the ' + (vtPayType === 'bank' ? 'account holder' : 'cardholder') + ' name.'); return; }
    const parts = vtName.trim().split(' ');
    let extra: any;
    if (vtPayType === 'bank') {
      // ACH / bank: plain fields (no secure iframe). method:'bank' routes Stax.js to the bank tokenizer.
      if (!/^\d{9}$/.test(vtRouting.trim())) { setVtErr('Enter a valid 9-digit routing number.'); return; }
      if (!vtAccount.trim()) { setVtErr('Enter the bank account number.'); return; }
      extra = {
        method: 'bank', total: amt,
        firstname: parts[0] || vtName.trim(), lastname: parts.slice(1).join(' ') || '-',
        bank_account: vtAccount.trim(), bank_routing: vtRouting.trim(),
        bank_type: vtBankType, bank_holder_type: vtHolderType,
        email: vtLookup?.email || undefined, phone: vtLookup?.phone || undefined,
        meta: { fr_invoice: vtLookup?.invoiceNumber, memo: `Critter Stop invoice #${vtLookup?.invoiceNumber} (phone ACH)`, reference: vtLookup?.invoiceNumber, source: 'hub-virtual-terminal' },
      };
    } else {
      // Card: hosted iframe supplies number+CVV; we pass the rest (name, exp, zip).
      if (!vtExpMonth || !vtExpYear) { setVtErr('Enter the card expiration (MM / YYYY).'); return; }
      if (!vtZip.trim()) { setVtErr('Enter the billing zip code.'); return; }
      extra = {
        method: 'card', total: amt,
        firstname: parts[0] || vtName.trim(), lastname: parts.slice(1).join(' ') || '-',
        month: vtExpMonth.padStart(2, '0'),
        year: vtExpYear.length === 2 ? `20${vtExpYear}` : vtExpYear,
        address_zip: vtZip.trim(),
        email: vtLookup?.email || undefined, phone: vtLookup?.phone || undefined,
        meta: { fr_invoice: vtLookup?.invoiceNumber, memo: `Critter Stop invoice #${vtLookup?.invoiceNumber} (phone payment)`, reference: vtLookup?.invoiceNumber, source: 'hub-virtual-terminal' },
      };
    }
    setVtBusy(true);
    try {
      // meta.fr_invoice tags the payment so the webhook/bridge records it to the FR invoice.
      // Passing customer_id means Stax doesn't require a full billing address (address_1/city).
      if (vtLookup?.staxCustomerId) extra.customer_id = vtLookup.staxCustomerId;
      const txn = await fattjs.pay(extra);
      const ok = txn && (txn.success === true || String(txn.status || '').toLowerCase() === 'settled' || txn.id);
      if (!ok) { setVtErr('Payment was not approved. ' + (txn?.message || '')); setVtBusy(false); return; }
      // Nudge the bridge to record immediately (webhook will also fire; bridge is idempotent).
      try { await fetch('/api/stax/payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reconcile' }) }); } catch {}
      setVtResult({ amount: amt, last4: txn.payment_method?.card_last_four || txn.last_four || '', id: txn.id, invoice: vtLookup?.invoiceNumber, customer: vtLookup?.customerName });
      loadReport();
    } catch (e: any) {
      // Stax.js rejects with varied shapes: Error, {message}, {payment_attempt_message}, validation {errors},
      // or the raw transaction with a message. Dig out something readable + log the full object for inspection.
      console.error('[virtual terminal] pay() error:', e);
      let msg = '';
      if (typeof e === 'string') msg = e;
      else if (e?.message) msg = e.message;
      else if (e?.payment_attempt_message) msg = e.payment_attempt_message;
      else if (e?.errors) msg = (Array.isArray(e.errors) ? e.errors.join('; ') : JSON.stringify(e.errors));
      else if (e?.detail) msg = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
      else { try { msg = JSON.stringify(e); } catch { msg = 'unknown error'; } }
      setVtErr('Payment failed: ' + String(msg).slice(0, 300));
    }
    setVtBusy(false);
  }
  async function deleteLink(l: any) {
    if (!confirm(`Delete the unpaid payment link for invoice ${l.frInvoiceNumber} (${l.customerName || ''})? This removes it here and voids the Stax invoice.`)) return;
    try {
      const r = await fetch('/api/stax/payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: l.id }) });
      const j = await r.json();
      if (j.error) { alert('Delete failed: ' + j.error); return; }
      loadLinks();
    } catch (e: any) { alert('Delete error: ' + String(e).slice(0, 120)); }
  }

  const thC: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0, zIndex: 1 };
  const tdC: React.CSSProperties = { textAlign: 'center', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const thR: React.CSSProperties = { ...thC, textAlign: 'right' };
  const tdR: React.CSSProperties = { ...tdC, textAlign: 'right' };
  const inp: React.CSSProperties = { display: 'block', width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', marginTop: 4, boxSizing: 'border-box' };
  const statusPill = (s: string) => { const c: any = { sent: ['#FBF3E5', '#BA7517'], viewed: ['#E6F1FB', '#185FA5'], paid: ['#E1F5EE', '#0F6E56'], refunded: ['#EFEDE6', '#64748b'], expired: ['#F1EFE8', '#888780'] }; const [bg, fg] = c[s] || c.expired; return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: bg, color: fg }}>{s}</span>; };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <BackButton />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>💳 Stax Payments</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>Send a customer a payment link for a specific invoice. Payments record back into FieldRoutes automatically.</p>

      <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 24 }}>
        {(['links', 'report', 'onsite'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 13, padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#2C2C2A' : '#888780', fontWeight: tab === t ? 600 : 400 }}>{t === 'links' ? `Payment Links (${links.length})` : t === 'report' ? 'Payment Report' : `Onsite Payments${report?.onsite?.length ? ` (${report.onsite.length})` : ''}`}</button>
        ))}
      </div>

      {tab === 'links' && (() => {
        const q = linkSearch.trim().toLowerCase();
        const filteredLinks = q ? links.filter(l => (l.customerName || '').toLowerCase().includes(q) || String(l.frInvoiceNumber || '').toLowerCase().includes(q)) : links;
        return (<>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
          <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Search by customer name or invoice #…" style={{ flex: 1, maxWidth: 360, fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', boxSizing: 'border-box' }} />
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button onClick={openVt} style={{ fontSize: 13, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>💳 Take Payment</button>
            <button onClick={openModal} style={{ fontSize: 13, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Send Payment Link</button>
          </span>
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
                    <td style={tdC}><span style={{ display: 'inline-flex', gap: 4 }}><button onClick={() => navigator.clipboard.writeText(l.url)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#185FA5', cursor: 'pointer' }}>Copy</button>{(l.status === 'sent' || l.status === 'viewed' || l.status === 'expired') && <button onClick={() => deleteLink(l)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Delete</button>}</span></td>
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
        const q = reportSearch.trim().toLowerCase();
        const byInv = (arr: any[]) => (arr || []).filter((r: any) => !q || String(r.frInvoiceNumber || '').toLowerCase().includes(q) || String(r.customerName || '').toLowerCase().includes(q));
        const tiles: Array<{ key: typeof reportStatus; label: string; color: string }> = [
          { key: 'recorded', label: 'Recorded in FR', color: '#128a3f' },
          { key: 'refunded', label: 'Refunded', color: '#64748b' },
          { key: 'flagged', label: 'Flagged', color: s.flagged?.count ? '#b91c1c' : '#888780' },
          { key: 'failed', label: 'Failed', color: s.failed?.count ? '#b91c1c' : '#888780' },
          { key: 'declined', label: 'Declined', color: s.declined?.count ? '#A32D2D' : '#888780' },
          { key: 'pending', label: 'Pending', color: '#BA7517' },
        ];
        const active = tiles.find(t => t.key === reportStatus)!;
        const rows = byInv(report[reportStatus] || []);
        const withReason = reportStatus === 'flagged' || reportStatus === 'failed' || reportStatus === 'declined';
        const withRefund = reportStatus === 'recorded' && allowRefund;
        return (<>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {tiles.map(t => {
              const d = s[t.key]; const sel = reportStatus === t.key;
              return (
                <button key={t.key} onClick={() => setReportStatus(t.key)} style={{ textAlign: 'left', border: sel ? `1.5px solid ${t.color}` : '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: sel ? '#FBFBF9' : '#fff', minWidth: 125, cursor: 'pointer', boxShadow: sel ? '0 1px 4px rgba(44,44,42,0.1)' : 'none' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{d?.count ?? 0}</div>
                  <div style={{ fontSize: 11, color: '#888780' }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{money(d?.total ?? 0)}</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: active.color }}>{active.label} ({rows.length})</div>
            <input value={reportSearch} onChange={e => setReportSearch(e.target.value)} placeholder="Search by invoice #…" style={{ maxWidth: 260, fontSize: 13, padding: '8px 11px', borderRadius: 8, border: '0.5px solid #E8E7E3', boxSizing: 'border-box' }} />
          </div>
          <div style={{ border: `0.5px solid ${active.color === '#b91c1c' ? '#F7C1C1' : '#E8E7E3'}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Customer</th><th style={thC}>Office</th><th style={thC}>Invoice #</th><th style={thC}>Method</th><th style={thC}>Last Four</th><th style={thC}>Via</th><th style={thC}>When</th>
                  {withReason && <th style={thC}>Reason</th>}
                  {withRefund && <th style={thC}>Refund</th>}
                </tr></thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id || r.staxTransactionId}>
                      <td style={tdC}>{r.staxTransactionId}</td>
                      <td style={tdR}>{money(r.amount)}</td>
                      <td style={tdC}>{r.customerName || '—'}</td>
                      <td style={tdC}>{r.office || '—'}</td>
                      <td style={tdC}>{r.frInvoiceNumber || '—'}</td>
                      <td style={tdC}>{method(r.frPaymentMethod)}</td>
                      <td style={tdC}>{r.cardLast4 ? `•••• ${r.cardLast4}` : '—'}</td>
                      <td style={tdC}>{r.source}</td>
                      <td style={tdC}>{fmt(r.processedAt || r.createdAt)}</td>
                      {withReason && <td style={{ ...tdC, whiteSpace: 'normal', maxWidth: 300 }}>{r.failReason || '—'}</td>}
                      {withRefund && <td style={tdC}><button onClick={() => setRefundModal({ txnId: r.staxTransactionId, invoice: r.frInvoiceNumber, amount: r.amount })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #b91c1c', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Refund</button></td>}
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={9 + (withReason ? 1 : 0) + (withRefund ? 1 : 0)} style={{ ...tdC, color: '#888780', padding: 18 }}>{q ? 'No matches.' : 'None.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>);
      })()}

      {/* ---- Onsite Payments tab (PM mobile-reader payments awaiting link to an invoice) ---- */}
      {tab === 'onsite' && (() => {
        const rows = report?.onsite || [];
        return (
          <div>
            <div style={{ fontSize: 13, color: '#888780', marginBottom: 14 }}>
              Payments taken onsite via the Stax mobile reader (no invoice at capture). Identified by the customer&apos;s reference (FR customer ID). Once the invoice is created in FieldRoutes, click <b>Link to invoice</b> — the payment then moves into the Payment Report.
            </div>
            {rows.length === 0 ? (
              <div style={{ fontSize: 14, color: '#B4B2A9', padding: '24px 0', textAlign: 'center' }}>No onsite payments awaiting link.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid #E8E7E3' }}>
                  <th style={thC}>Stax Txn</th><th style={thR}>Amount</th><th style={thC}>Customer</th><th style={thC}>FR Cust ID</th><th style={thC}>Last Four</th><th style={thC}>When</th><th style={thC}>Action</th>
                </tr></thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                      <td style={tdC}>{String(r.staxTransactionId).slice(0, 8)}…</td>
                      <td style={tdR}>{money(r.amount)}</td>
                      <td style={tdC}>{r.frCustomerName || <span style={{ color: '#B4B2A9' }}>— (not in DB)</span>}</td>
                      <td style={tdC}>{r.frCustomerId || '—'}</td>
                      <td style={tdC}>{r.cardLast4 ? `•••• ${r.cardLast4}` : '—'}</td>
                      <td style={tdC}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                      <td style={tdC}><button onClick={() => linkOnsite(r.staxTransactionId, '')} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Link to invoice</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
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
      {/* ---- Take Payment (Virtual Terminal) modal ---- */}
      {vtOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,44,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => !vtBusy && setVtOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 500, maxWidth: '94vw', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#2C2C2A' }}>💳 Take Payment</div>
              <button onClick={() => setVtOpen(false)} style={{ fontSize: 20, lineHeight: 1, border: 'none', background: 'transparent', color: '#888780', cursor: 'pointer' }}>×</button>
            </div>

            {vtResult ? (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F6E56', marginTop: 6 }}>Payment Approved</div>
                <div style={{ fontSize: 14, color: '#2C2C2A', marginTop: 10 }}>{money(vtResult.amount)} charged{vtResult.last4 ? ` · card ending ${vtResult.last4}` : ''}</div>
                <div style={{ fontSize: 13, color: '#888780', marginTop: 4 }}>{vtResult.customer} · Invoice #{vtResult.invoice}</div>
                <div style={{ fontSize: 12, color: '#888780', marginTop: 8 }}>Recording to FieldRoutes automatically.</div>
                <button onClick={() => setVtOpen(false)} style={{ marginTop: 18, fontSize: 14, padding: '11px 24px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Done</button>
              </div>
            ) : vtStep === 'invoice' ? (
              <>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>FieldRoutes Invoice #</label>
                <input value={vtInvoice} onChange={e => setVtInvoice(e.target.value)} onKeyDown={e => e.key === 'Enter' && vtDoLookup()} placeholder="e.g. 275122" autoFocus
                  style={{ width: '100%', marginTop: 6, fontSize: 15, padding: '11px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />
                {vtErr && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{vtErr}</div>}
                <button onClick={vtDoLookup} disabled={vtBusy} style={{ width: '100%', marginTop: 18, fontSize: 14, padding: '12px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: vtBusy ? 'wait' : 'pointer' }}>{vtBusy ? 'Looking up…' : 'Look Up Invoice'}</button>
              </>
            ) : (
              <>
                {/* Invoice summary */}
                <div style={{ background: '#F6F8FB', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#2C2C2A' }}>{vtLookup?.customerName}</div>
                  <div style={{ fontSize: 12, color: '#888780', marginTop: 2 }}>{vtLookup?.office} · Invoice #{vtLookup?.invoiceNumber}</div>
                  <div style={{ fontSize: 13, color: '#2C2C2A', marginTop: 6 }}>Balance due: <b>{money(vtLookup?.balance || 0)}</b></div>
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>Amount to charge</label>
                <input value={vtAmount} onChange={e => setVtAmount(e.target.value)} type="number" step="0.01" placeholder="0.00"
                  style={{ width: '100%', marginTop: 6, marginBottom: 12, fontSize: 15, padding: '11px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />
                {/* Payment method toggle: Card vs Bank (ACH) */}
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>Payment method</label>
                <div style={{ display: 'flex', gap: 8, margin: '6px 0 14px' }}>
                  <button onClick={() => { setVtPayType('card'); setVtErr(''); }} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 8, cursor: 'pointer', border: vtPayType === 'card' ? '1.5px solid #0F6E56' : '0.5px solid #D3D1C7', background: vtPayType === 'card' ? '#E8F3EE' : '#fff', color: vtPayType === 'card' ? '#0F6E56' : '#888780' }}>💳 Card</button>
                  <button onClick={() => { setVtPayType('bank'); setVtErr(''); }} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px', borderRadius: 8, cursor: 'pointer', border: vtPayType === 'bank' ? '1.5px solid #0F6E56' : '0.5px solid #D3D1C7', background: vtPayType === 'bank' ? '#E8F3EE' : '#fff', color: vtPayType === 'bank' ? '#0F6E56' : '#888780' }}>🏦 Bank (ACH)</button>
                </div>

                <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>{vtPayType === 'bank' ? 'Account holder name' : 'Cardholder name'}</label>
                <input value={vtName} onChange={e => setVtName(e.target.value)} placeholder={vtPayType === 'bank' ? 'Name on account' : 'Name on card'}
                  style={{ width: '100%', marginTop: 6, marginBottom: 12, fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />

                {vtPayType === 'card' ? (
                  <>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>Card details</label>
                    {!staxReady && <div style={{ fontSize: 13, color: '#888780', marginTop: 8 }}>Loading secure card form…</div>}
                    <div style={{ marginTop: 6 }}>
                      <div id="vt-card-number" style={{ border: '0.5px solid #D3D1C7', borderRadius: 8, height: 40, marginBottom: 8, overflow: 'hidden' }} />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div id="vt-card-cvv" style={{ border: '0.5px solid #D3D1C7', borderRadius: 8, height: 40, width: 130, overflow: 'hidden' }} />
                        <input value={vtExpMonth} onChange={e => setVtExpMonth(e.target.value.replace(/\D/g,'').slice(0,2))} placeholder="MM" maxLength={2}
                          style={{ width: 54, fontSize: 14, padding: '10px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box', textAlign: 'center' }} />
                        <span style={{ color: '#B4B2A9' }}>/</span>
                        <input value={vtExpYear} onChange={e => setVtExpYear(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="YYYY" maxLength={4}
                          style={{ width: 72, fontSize: 14, padding: '10px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box', textAlign: 'center' }} />
                        <input value={vtZip} onChange={e => setVtZip(e.target.value.replace(/\D/g,'').slice(0,5))} placeholder="Zip" maxLength={5}
                          style={{ flex: 1, fontSize: 14, padding: '10px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 8 }}>🔒 Card number & CVV are encrypted by Stax — never stored on our servers.</div>
                  </>
                ) : (
                  <>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#888780' }}>Bank details</label>
                    <div style={{ marginTop: 6 }}>
                      <input value={vtRouting} onChange={e => setVtRouting(e.target.value.replace(/\D/g,'').slice(0,9))} placeholder="Routing number (9 digits)" inputMode="numeric"
                        style={{ width: '100%', marginBottom: 8, fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />
                      <input value={vtAccount} onChange={e => setVtAccount(e.target.value.replace(/\D/g,''))} placeholder="Account number" inputMode="numeric"
                        style={{ width: '100%', marginBottom: 8, fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', boxSizing: 'border-box' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select value={vtBankType} onChange={e => setVtBankType(e.target.value as any)} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
                          <option value="checking">Checking</option>
                          <option value="savings">Savings</option>
                        </select>
                        <select value={vtHolderType} onChange={e => setVtHolderType(e.target.value as any)} style={{ flex: 1, fontSize: 13, padding: '10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
                          <option value="personal">Personal</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 8 }}>🔒 Bank details are encrypted by Stax — never stored on our servers. ACH typically settles in 3–5 business days.</div>
                  </>
                )}
                {vtErr && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{vtErr}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => { setVtStep('invoice'); setVtErr(''); }} disabled={vtBusy} style={{ flex: 1, fontSize: 13, padding: '12px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Back</button>
                  <button onClick={vtCharge} disabled={vtBusy || !staxReady} style={{ flex: 1.6, fontSize: 14, padding: '12px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 600, cursor: (vtBusy || !staxReady) ? 'wait' : 'pointer' }}>{vtBusy ? 'Processing…' : `${vtPayType === 'bank' ? 'Charge (ACH)' : 'Charge'} ${vtAmount ? money(parseFloat(vtAmount) || 0) : ''}`}</button>
                </div>
              </>
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
