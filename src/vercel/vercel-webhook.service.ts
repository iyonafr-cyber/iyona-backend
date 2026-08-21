import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { RevisionsService } from '../revisions/revisions.service';

/**
 * Processes inbound Vercel deployment lifecycle events.
 *
 * Vercel webhook payload shape (abbreviated):
 * {
 *   type: "deployment.succeeded" | "deployment.error" | "deployment.canceled" | ...
 *   payload: {
 *     deployment: {
 *       id: string;          // Vercel deployment ID (dpl_xxx)
 *       url: string;         // deployment hostname (no protocol)
 *       readyState: string;
 *     }
 *   }
 * }
 */
@Injectable()
export class VercelWebhookService {
  private readonly logger = new Logger(VercelWebhookService.name);

  constructor(
    @Inject(forwardRef(() => RevisionsService))
    private readonly revisionsService: RevisionsService,
  ) {}

  async handleVercelEvent(event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') {
      this.logger.warn('[VercelWebhook] Received non-object event — ignoring');
      return;
    }

    const e = event as Record<string, unknown>;
    const type = typeof e.type === 'string' ? e.type : null;
    if (!type) {
      this.logger.warn('[VercelWebhook] Event missing `type` field — ignoring');
      return;
    }

    // Extract deployment ID from payload.deployment.id (Vercel v3 webhook shape)
    const innerPayload = e.payload as Record<string, unknown> | undefined;
    const deployment = innerPayload?.deployment as
      | Record<string, unknown>
      | undefined;
    const vercelDeploymentId =
      typeof deployment?.id === 'string' ? deployment.id : null;
    const vercelDeploymentUrl =
      typeof deployment?.url === 'string' ? deployment.url : undefined;

    if (!vercelDeploymentId) {
      this.logger.warn(
        `[VercelWebhook] Event type=${type} has no payload.deployment.id — ignoring`,
      );
      return;
    }

    this.logger.log(
      `[VercelWebhook] Received type=${type} for deployment ${vercelDeploymentId}`,
    );

    await this.revisionsService.notifyVercelDeploymentEvent({
      type,
      vercelDeploymentId,
      vercelDeploymentUrl,
    });
  }
}
