import type { EmailMessage } from '../../auth/application/ports.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function invitationEmail(
  to: string,
  inviter: string,
  roleLabel: string,
  link: string,
  days: number,
): EmailMessage {
  return {
    to,
    subject: `${inviter} invited you to TrustedHands Ops`,
    text: `${inviter} invited you to join the TrustedHands operations team as ${roleLabel}.\n\nSet up your account: ${link}\n\nThe link works once and expires in ${days} days.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF6EE;font-family:Arial,Helvetica,sans-serif;color:#13294B">
<table role="presentation" width="100%" style="max-width:520px;margin:0 auto"><tr><td style="background:#FFFFFF;border:1px solid #E8DFD1;border-radius:16px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">Join TrustedHands Ops</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(inviter)} invited you to the operations team as <strong>${escapeHtml(roleLabel)}</strong>.</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#C2410C;color:#FFFFFF;font-weight:bold;text-decoration:none">Set up my account</a></p>
<p style="margin:0;font-size:13px;color:#5A6478">The link works once and expires in ${days} days.</p>
</td></tr></table></body></html>`,
  };
}
