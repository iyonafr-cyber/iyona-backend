import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { VercelWebhookService } from './vercel-webhook.service';

/**
 * Public endpoint that receives Vercel deployment lifecycle events.
 *
 * Vercel sends a signed POST request (HMAC-SHA1 via `x-vercel-signature`)
 * to this URL whenever a deployment transitions state. We use these events
 * to update our Deployment documents in real-time instead of polling
 * Vercel's API every 5 seconds.
 *
 * Configure the webhook URL in Vercel:
 *   POST https://api.vercel.com/v1/webhooks
 *   body: { url: "https://<your-api>/integrations/vercel-events", events: ["deployment.succeeded","deployment.error","deployment.canceled"] }
 *
 * Store the returned secret in env as VERCEL_WEBHOOK_SECRET.
 */
@Controller('integrations')
export class VercelWebhookController {
  private readonly logger = new Logger(VercelWebhookController.name);

  constructor(private readonly webhookService: VercelWebhookService) {}

  @Post('vercel-events')
  @HttpCode(HttpStatus.OK)
  handleEvent(@Req() req: RawBodyRequest<Request>, @Res() res: Response): void {
    const secret = process.env.VERCEL_WEBHOOK_SECRET;
    const signature = req.headers['x-vercel-signature'] as string | undefined;

    // FAIL-CLOSED. This endpoint drives Deployment state transitions (build
    // success/failure), so an unauthenticated caller must never reach the
    // handler. Without a configured secret we cannot verify anything, so we
    // reject rather than "allow".
    if (!secret) {
      this.logger.error(
        '[VercelWebhook] VERCEL_WEBHOOK_SECRET is not configured — rejecting event (set the secret to enable real-time deploy status)',
      );
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }

    // `req.body` is a Buffer here: the VERCEL_WEBHOOK_PATH route is mounted
    // with express `raw()` BEFORE the JSON parser (see main.ts), exactly like
    // the Stripe webhook. `req.rawBody` is NOT populated (Nest is not created
    // with { rawBody: true }), so we must verify + parse from `req.body`.
    const rawBody: Buffer | undefined = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : undefined;
    if (!rawBody) {
      this.logger.error(
        '[VercelWebhook] Raw body unavailable — cannot verify signature; rejecting',
      );
      res.status(400).json({ error: 'Raw body required' });
      return;
    }

    if (!signature) {
      this.logger.warn(
        '[VercelWebhook] Missing x-vercel-signature header — ignoring event',
      );
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('[VercelWebhook] Invalid signature — ignoring event');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn('[VercelWebhook] Invalid JSON payload');
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // Respond 200 immediately so Vercel doesn't retry while we process.
    res.status(200).json({ received: true });

    // Process asynchronously — errors are logged, not thrown.
    void this.webhookService
      .handleVercelEvent(payload)
      .catch((err: unknown) => {
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : JSON.stringify(err);
        this.logger.error(`[VercelWebhook] handleVercelEvent threw: ${detail}`);
      });
  }
}
