import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { UnavailableError } from '../../../shared/domain/domain-error.js';
import { SmsSender } from '../application/ports.js';

/** Recipient status codes that mean the message was accepted for delivery. */
const ACCEPTED = new Set([100, 101, 102]); // Processed, Sent, Queued

interface SendResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: Array<{
      statusCode: number;
      status: string;
      number: string;
      messageId?: string;
    }>;
  };
}

/** Africa's Talking SMS API: https://developers.africastalking.com/docs/sms/sending */
@Injectable()
export class AfricasTalkingSmsSender extends SmsSender {
  private readonly logger = new Logger(AfricasTalkingSmsSender.name);
  private readonly apiKey: string;
  private readonly username: string;
  private readonly senderId: string | undefined;
  private readonly endpoint: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.apiKey = config.get('AFRICAS_TALKING_API_KEY', { infer: true })!;
    this.username = config.get('AFRICAS_TALKING_USERNAME', { infer: true })!;
    this.senderId =
      config.get('AFRICAS_TALKING_SENDER_ID', { infer: true }) || undefined;
    this.endpoint =
      this.username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';
  }

  async send(to: string, text: string): Promise<void> {
    const body = new URLSearchParams({
      username: this.username,
      to,
      message: text,
    });
    if (this.senderId) body.set('from', this.senderId);

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.error(
        `Africa's Talking unreachable: ${(error as Error).message}`,
      );
      throw unavailable();
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.error(
        `Africa's Talking rejected SMS (${res.status}): ${raw}`,
      );
      throw unavailable();
    }
    const recipient = (JSON.parse(raw) as SendResponse).SMSMessageData
      ?.Recipients?.[0];
    if (!recipient || !ACCEPTED.has(recipient.statusCode)) {
      // e.g. InsufficientBalance, InvalidSenderId, InvalidPhoneNumber
      this.logger.error(
        `SMS to ${maskNumber(to)} not accepted: ${recipient?.status ?? raw}`,
      );
      throw unavailable();
    }
  }
}

const unavailable = () =>
  new UnavailableError(
    'sms_failed',
    "We couldn't send the text message. Try again in a moment.",
  );

/** Keep phone numbers out of logs: +250781234567 → +25078****567 */
const maskNumber = (n: string) => `${n.slice(0, 6)}****${n.slice(-3)}`;
