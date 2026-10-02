// Email sending via Resend. From help@critterstop.com (domain verified in Resend).
// No-ops gracefully if RESEND_API_KEY isn't set yet (so the payment-link flow works before email is wired up).
import { Resend } from 'resend';

const FROM = 'Critter Stop <help@critterstop.com>';

export async function sendPaymentLinkEmail(opts: { to: string; customerName: string; amount: number; invoiceNumber: string; url: string }): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set' };
  if (!opts.to) return { sent: false, reason: 'no customer email' };

  const amount = '$' + opts.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #2C2C2A;">
      <div style="font-size: 20px; font-weight: 700; margin-bottom: 4px;">Critter Stop</div>
      <div style="font-size: 13px; color: #888780; margin-bottom: 24px;">Payment request</div>
      <p style="font-size: 15px; line-height: 1.6;">Hi ${opts.customerName || 'there'},</p>
      <p style="font-size: 15px; line-height: 1.6;">Here's a secure link to pay your invoice. Click below to pay by card or bank — no account needed.</p>
      <div style="background: #F7F6F3; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
        <div style="font-size: 13px; color: #888780;">Amount due</div>
        <div style="font-size: 32px; font-weight: 700; margin: 4px 0;">${amount}</div>
        <div style="font-size: 13px; color: #888780; margin-bottom: 16px;">Invoice #${opts.invoiceNumber}</div>
        <a href="${opts.url}" style="display: inline-block; background: #185FA5; color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 8px;">Pay ${amount}</a>
      </div>
      <p style="font-size: 13px; color: #888780; line-height: 1.6;">If the button doesn't work, copy and paste this link:<br><a href="${opts.url}" style="color: #185FA5;">${opts.url}</a></p>
      <p style="font-size: 13px; color: #888780; line-height: 1.6;">Thank you,<br>Critter Stop</p>
    </div>`;

  try {
    const resend = new Resend(key);
    const r = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: `Your Critter Stop payment link — Invoice #${opts.invoiceNumber}`,
      html,
    });
    if ((r as any)?.error) return { sent: false, reason: String((r as any).error?.message || 'send failed') };
    return { sent: true };
  } catch (e: any) {
    return { sent: false, reason: String(e).slice(0, 150) };
  }
}
