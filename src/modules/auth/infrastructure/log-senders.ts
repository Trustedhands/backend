import { Injectable, Logger } from '@nestjs/common';
import { type EmailMessage, Mailer, SmsSender } from '../application/ports.js';

/** Development only (refused in production by env validation): prints instead of sending. */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `[not sent] To ${message.to} · ${message.subject}\n${message.text}`,
    );
  }
}

@Injectable()
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  async send(to: string, text: string): Promise<void> {
    this.logger.warn(`[not sent] To ${to}: ${text}`);
  }
}
