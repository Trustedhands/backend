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

export interface NewRequestSummary {
  reference: string;
  service: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  scheduledAt: Date;
  area: string;
  description: string;
  link: string;
}

/** Tells a staff member that a client has submitted a request. */
export function newRequestStaffEmail(
  to: string,
  r: NewRequestSummary,
): EmailMessage {
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Kigali',
  }).format(r.scheduledAt);
  const contact = r.clientPhone
    ? `${r.clientEmail}, ${r.clientPhone}`
    : r.clientEmail;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:14px;color:#5A6478;vertical-align:top">${label}</td><td style="padding:4px 0;font-size:14px">${escapeHtml(value)}</td></tr>`;
  return {
    to,
    subject: `New request ${r.reference}: ${r.service} for ${r.clientName}`,
    text: [
      `${r.clientName} (${contact}) has requested ${r.service}.`,
      '',
      `Reference: ${r.reference}`,
      `When: ${when}`,
      `Where: ${r.area}`,
      '',
      r.description,
      '',
      `Open it in the console: ${r.link}`,
    ].join('\n'),
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF6EE;font-family:Arial,Helvetica,sans-serif;color:#13294B">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto"><tr><td style="background:#FFFFFF;border:1px solid #E8DFD1;border-radius:16px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">New request ${escapeHtml(r.reference)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5"><strong>${escapeHtml(r.clientName)}</strong> has requested <strong>${escapeHtml(r.service)}</strong>.</p>
<table role="presentation" style="margin:0 0 12px">${row('Client', contact)}${row('When', when)}${row('Where', r.area)}</table>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(r.description)}</p>
<a href="${escapeHtml(r.link)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#E8641B;color:#FFFFFF;font-weight:700;text-decoration:none">Open in the console</a>
</td></tr></table></body></html>`,
  };
}
