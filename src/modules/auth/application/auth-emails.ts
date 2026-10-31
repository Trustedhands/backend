import type { EmailMessage } from './ports.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Inline-styled layout in the app's palette; email clients ignore <style> blocks. */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FBF6EE;font-family:Arial,Helvetica,sans-serif;color:#13294B">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto">
    <tr><td style="padding:0 0 20px;font-size:20px;font-weight:800">
      <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#E8641B;vertical-align:middle"></span>
      <span style="vertical-align:middle;margin-left:8px">TrustedHands</span>
    </td></tr>
    <tr><td style="background:#FFFFFF;border:1px solid #E8DFD1;border-radius:16px;padding:24px">
      <h1 style="margin:0 0 12px;font-size:22px">${title}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 4px;font-size:12px;color:#5A6478">
      Verified help for home, errands and repairs in Kigali.
    </td></tr>
  </table>
</body></html>`;
}

function codeBlock(code: string): string {
  return `<p style="margin:16px 0;font-size:32px;font-weight:800;letter-spacing:8px;font-family:'Courier New',monospace">${code}</p>`;
}

const p = (text: string) =>
  `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#13294B">${text}</p>`;
const muted = (text: string) =>
  `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#5A6478">${text}</p>`;

export function emailVerificationEmail(
  to: string,
  name: string,
  code: string,
  minutes: number,
): EmailMessage {
  const hi = `Hi ${escapeHtml(name)},`;
  return {
    to,
    subject: `${code} is your TrustedHands verification code`,
    text: `Hi ${name},\n\nYour TrustedHands verification code is ${code}. It expires in ${minutes} minutes.\n\nIf you didn't create a TrustedHands account, you can ignore this email.`,
    html: layout(
      'Confirm your email',
      p(hi) +
        p('Enter this code in the app to confirm your email address:') +
        codeBlock(code) +
        muted(
          `It expires in ${minutes} minutes. If you didn't create a TrustedHands account, you can ignore this email.`,
        ),
    ),
  };
}

export function passwordResetEmail(
  to: string,
  name: string,
  code: string,
  minutes: number,
): EmailMessage {
  return {
    to,
    subject: `${code} is your TrustedHands password reset code`,
    text: `Hi ${name},\n\nUse code ${code} to choose a new TrustedHands password. It expires in ${minutes} minutes.\n\nIf you didn't ask to reset your password, ignore this email; your password stays the same.`,
    html: layout(
      'Reset your password',
      p(`Hi ${escapeHtml(name)},`) +
        p('Enter this code in the app to choose a new password:') +
        codeBlock(code) +
        muted(
          `It expires in ${minutes} minutes. If you didn't ask to reset your password, ignore this email; your password stays the same.`,
        ),
    ),
  };
}

export function passwordChangedEmail(to: string, name: string): EmailMessage {
  return {
    to,
    subject: 'Your TrustedHands password was changed',
    text: `Hi ${name},\n\nYour TrustedHands password was just changed and you were signed out on other devices.\n\nIf this wasn't you, reset your password from the app straight away and contact us.`,
    html: layout(
      'Password changed',
      p(`Hi ${escapeHtml(name)},`) +
        p(
          'Your TrustedHands password was just changed, and you were signed out on your other devices.',
        ) +
        muted(
          "If this wasn't you, reset your password from the app straight away and contact us.",
        ),
    ),
  };
}
