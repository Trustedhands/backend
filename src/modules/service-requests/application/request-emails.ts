import type { EmailMessage } from '../../auth/application/ports.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function paymentReminderEmail(
  to: string,
  name: string,
  service: string,
  reference: string,
  totalRwf: number,
): EmailMessage {
  const amount = `${new Intl.NumberFormat('en-US').format(totalRwf)} RWF`;
  return {
    to,
    subject: `Your price for ${service} is ready (${reference})`,
    text: `Hi ${name},\n\nYour price for ${service} (${reference}) is ${amount}. Open the TrustedHands app to review and pay, or ask us to adjust it.\n\nWe hold your worker until then.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF6EE;font-family:Arial,Helvetica,sans-serif;color:#13294B">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto"><tr><td style="background:#FFFFFF;border:1px solid #E8DFD1;border-radius:16px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">Your price is ready</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Hi ${escapeHtml(name)}, your price for <strong>${escapeHtml(service)}</strong> (${escapeHtml(reference)}) is <strong>${amount}</strong>.</p>
<p style="margin:0;font-size:15px;line-height:1.5">Open the TrustedHands app to review and pay, or ask us to adjust it. We hold your worker until then.</p>
</td></tr></table></body></html>`,
  };
}
