export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email (verification codes, password resets). */
export abstract class Mailer {
  abstract send(message: EmailMessage): Promise<void>;
}

/** Sends text messages (phone verification codes). */
export abstract class SmsSender {
  abstract send(to: string, text: string): Promise<void>;
}
