import type { EmailMessage } from '../../auth/application/ports.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** A support reply; the client can answer by replying to the email. */
export function ticketReplyEmail(
  to: string,
  clientName: string,
  reference: string,
  subject: string,
  body: string,
  staffName: string,
): EmailMessage {
  return {
    to,
    subject: `Re: ${subject} (${reference})`,
    text: `Hi ${clientName},\n\n${body}\n\n${staffName}\nTrustedHands support · ${reference}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF6EE;font-family:Arial,Helvetica,sans-serif;color:#13294B">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto"><tr><td style="background:#FFFFFF;border:1px solid #E8DFD1;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(clientName)},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(body)}</p>
<p style="margin:0;font-size:14px;color:#5A6478">${escapeHtml(staffName)}<br>TrustedHands support · ${escapeHtml(reference)}</p>
</td></tr></table></body></html>`,
  };
}
