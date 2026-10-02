// SMS sending via Dialpad. From the Critter Stop business number (+12145612744).
// No-ops gracefully if DIALPAD_API_KEY isn't set. Normalizes US phone numbers to E164.
const DIALPAD_BASE = 'https://dialpad.com/api/v2';
const FROM_NUMBER = '+12145612744';

// Normalize a US phone number to E164 (+1XXXXXXXXXX). Returns null if it doesn't look valid.
export function toE164(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(raw).startsWith('+') && d.length >= 10) return `+${d}`;
  return null;
}

export async function sendPaymentLinkSms(opts: { to: string; customerName: string; amount: number; invoiceNumber: string; url: string }): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.DIALPAD_API_KEY;
  if (!key) return { sent: false, reason: 'DIALPAD_API_KEY not set' };
  const to = toE164(opts.to);
  if (!to) return { sent: false, reason: `invalid phone number (${opts.to || 'none'})` };

  const amount = '$' + opts.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = `Critter Stop: Hi ${opts.customerName || 'there'}, here's your secure payment link for invoice #${opts.invoiceNumber} (${amount}): ${opts.url}`;

  try {
    const r = await fetch(`${DIALPAD_BASE}/sms`, {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from_number: FROM_NUMBER, to_numbers: [to], text, infer_country_code: false }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `Dialpad ${r.status}: ${JSON.stringify(j).slice(0, 150)}` };
    return { sent: true };
  } catch (e: any) {
    return { sent: false, reason: String(e).slice(0, 150) };
  }
}
