import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Provider-agnostic transactional email sender.
 *
 * Resolution order:
 *   1. `RESEND_API_KEY` set       -> Resend HTTP API
 *   2. otherwise                  -> console-log the email (dev default)
 *
 * A future SMTP transport can be bolted on the same interface without
 * touching call-sites.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private get fromAddress(): string {
    return (
      process.env.MAIL_FROM ||
      process.env.RESEND_FROM ||
      'Jarvis <noreply@jarvis.site>'
    );
  }

  async send(payload: EmailPayload): Promise<void> {
    const provider = this.resolveProvider();
    try {
      if (provider === 'resend') {
        await this.sendViaResend(payload);
      } else {
        this.logToConsole(payload);
      }
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${payload.to} via ${provider}: ${(err as Error).message}`,
      );
      // Soft-fail: callers shouldn't error out if the mailer is down. For a
      // forgot-password flow this is actually desirable (don't leak whether
      // an address exists) and the token stays valid for the user to retry.
    }
  }

  private resolveProvider(): 'resend' | 'console' {
    if (process.env.RESEND_API_KEY) return 'resend';
    return 'console';
  }

  private async sendViaResend(payload: EmailPayload): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set');
    }
    await axios.post(
      'https://api.resend.com/emails',
      {
        from: this.fromAddress,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      },
    );
  }

  private logToConsole(payload: EmailPayload): void {
    this.logger.log(
      `📧 Email (dev/stub) -> to=${payload.to} subject=${payload.subject}`,
    );
    this.logger.debug(payload.text || payload.html);
  }
}
