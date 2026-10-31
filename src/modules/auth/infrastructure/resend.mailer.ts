import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { UnavailableError } from '../../../shared/domain/domain-error.js';
import { type EmailMessage, Mailer } from '../application/ports.js';

/** Resend REST API: https://resend.com/docs/api-reference/emails/send-email */
@Injectable()
export class ResendMailer extends Mailer {
  private readonly logger = new Logger(ResendMailer.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.apiKey = config.get('RESEND_API_KEY', { infer: true })!;
    this.from =
      config.get('EMAIL_FROM', { infer: true }) ??
      `TrustedHands <no-reply@${config.get('EMAIL_DOMAIN', { infer: true })}>`;
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Resend's error body describes the problem (e.g. unverified domain), never the key
      this.logger.error(
        `Resend rejected email "${message.subject}" (${res.status}): ${await res.text()}`,
      );
      throw new UnavailableError(
        'email_failed',
        "We couldn't send the email. Try again in a moment.",
      );
    }
  }
}
