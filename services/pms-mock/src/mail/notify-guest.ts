import { buildGuestEmail, type Email } from './guest-email.js';

export interface MailSender {
  send(email: Email): Promise<void>;
}

/**
 * No SMTP in this exercise: "sending" writes the mail to the log, as the case allows. Swapping in
 * a real provider means implementing MailSender (and passing `email.eventId` as its idempotency key).
 */
export class LogMailSender implements MailSender {
  constructor(private readonly write: (line: string) => void = console.log) {}

  async send(email: Email): Promise<void> {
    this.write(JSON.stringify({ time: new Date().toISOString(), service: 'mail', message: 'email (simulated)', ...email }));
  }
}

export type MailOutcome = 'sent' | 'ignored';

export class NotifyGuest {
  constructor(private readonly mail: MailSender) {}

  /** @throws PoisonMessageError for a malformed event; sender errors propagate so the consumer retries */
  async handle(raw: unknown): Promise<MailOutcome> {
    const email = buildGuestEmail(raw);
    if (email === null) return 'ignored';
    await this.mail.send(email);
    return 'sent';
  }
}
