'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

declare global { interface Window { appendHelcimPayIframe?: (token: string, allowExit?: boolean) => void; } }

export default function PayPage() {
  const params = useParams();
  const token = String((params as any)?.token || '');
  const [info, setInfo] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'paid' | 'error'>('loading');
  const [err, setErr] = useState('');

  // Load the HelcimPay.js script once.
  useEffect(() => {
    if (document.getElementById('helcim-pay-script')) return;
    const s = document.createElement('script');
    s.id = 'helcim-pay-script';
    s.src = 'https://secure.helcim.app/helcim-pay/services/start.js';
    document.head.appendChild(s);
  }, []);

  // Initialize the checkout session.
  useEffect(() => {
    if (!token) return;
    fetch('/api/pay-initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          const friendly = d.error === 'already paid' ? 'This payment has already been completed.'
            : d.error === 'invalid link' ? 'This payment link is invalid or expired.'
            : `Could not start payment: ${d.error}${d.helcim ? ' — ' + JSON.stringify(d.helcim).slice(0, 200) : ''}`;
          setErr(friendly); setStatus('error'); return;
        }
        setInfo(d); setStatus('ready');
      })
      .catch(() => { setErr('Something went wrong loading this payment.'); setStatus('error'); });
  }, [token]);

  // Listen for the HelcimPay result.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!info?.checkoutToken) return;
      if (e.data?.eventName !== `helcim-pay-js-${info.checkoutToken}`) return;
      const msg = e.data.eventMessage;

      // Failure message is a string containing "failed".
      if (typeof msg === 'string' && msg.toLowerCase().includes('failed')) { setErr('Payment was not completed. Please try again.'); return; }

      // Parse the transaction response. Only an APPROVED transaction counts as paid.
      let resp: any = msg;
      try { if (typeof msg === 'string') resp = JSON.parse(msg); } catch { resp = null; }
      // Helcim nests the transaction data; look for an approved status / transactionId.
      const data = resp?.data?.data || resp?.data || resp;
      const statusStr = String(data?.status || data?.response || '').toUpperCase();
      const approved = data && (statusStr === 'APPROVED' || data.transactionId || data.approvalCode);

      if (approved) {
        setStatus('paid'); // webhook records it in FR
      }
      // Any other message (hide/cancel/close) → do nothing; stay on the payment screen.
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [info]);

  function pay() {
    if (info?.checkoutToken && window.appendHelcimPayIframe) window.appendHelcimPayIframe(info.checkoutToken, true);
  }

  const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F6F3', fontFamily: 'ui-sans-serif, system-ui', padding: 20 }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#fff', borderRadius: 16, border: '0.5px solid #E8E7E3', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#2C2C2A', marginBottom: 4 }}>Critter Stop</div>
        <div style={{ fontSize: 13, color: '#888780', marginBottom: 24 }}>Secure payment</div>

        {status === 'loading' && <div style={{ color: '#888780', fontSize: 14 }}>Loading…</div>}

        {status === 'error' && <div style={{ color: '#b91c1c', fontSize: 14, background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 10, padding: '14px 16px' }}>{err}</div>}

        {status === 'ready' && info && (<>
          <div style={{ fontSize: 13, color: '#888780' }}>Amount due</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: '#2C2C2A', margin: '4px 0 2px' }}>{money(info.amount)}</div>
          <div style={{ fontSize: 13, color: '#888780', marginBottom: 6 }}>Invoice #{info.invoiceNumber}</div>
          {info.customerName && <div style={{ fontSize: 13, color: '#B4B2A9', marginBottom: 24 }}>{info.customerName}</div>}
          {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <button onClick={pay} style={{ width: '100%', fontSize: 15, padding: '14px', borderRadius: 10, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Pay {money(info.amount)}</button>
          <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 16 }}>Pay by card or bank (ACH). Secured by Helcim.</div>
        </>)}

        {status === 'paid' && (
          <div>
            <div style={{ fontSize: 44, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#128a3f', marginBottom: 4 }}>Payment complete</div>
            <div style={{ fontSize: 13, color: '#888780' }}>Thank you! A receipt has been sent to you.</div>
          </div>
        )}
      </div>
    </div>
  );
}
