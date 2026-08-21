import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import {
  ALL_WEBHOOK_EVENTS,
  Webhook,
  WebhookDocument,
  WebhookEventType,
} from './entities/webhook.entity';
import {
  WebhookDelivery,
  WebhookDeliveryDocument,
} from './entities/webhook-delivery.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { withObservability } from '../common/observability';

const MAX_ATTEMPTS = 6;
// Geometric backoff: 30s, 2m, 8m, 30m, 2h, 6h.
const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200, 21600];
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_SAMPLE_BYTES = 4_000;

interface DispatchOptions {
  /** If true, run the HTTP attempt synchronously (test-from-UI). */
  immediate?: boolean;
}

/**
 * E12 — outbound webhooks.
 *
 * Pattern:
 *   1. `enqueue(orgId, event, payload)` writes WebhookDelivery rows for every
 *      matching subscription, then schedules an immediate dispatch attempt.
 *   2. A cron job sweeps pending/failed deliveries whose `nextAttemptAt` is
 *      due (or stuck in_flight ones) and drains them with capped retries.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectModel(Webhook.name)
    private readonly webhookModel: Model<WebhookDocument>,
    @InjectModel(WebhookDelivery.name)
    private readonly deliveryModel: Model<WebhookDeliveryDocument>,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────

  async list(orgId: string, userId: string): Promise<WebhookDocument[]> {
    await this.orgs.requireMembership(orgId, userId);
    return this.webhookModel
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ createdAt: -1 });
  }

  async create(
    orgId: string,
    userId: string,
    name: string,
    url: string,
    events: WebhookEventType[],
  ): Promise<WebhookDocument> {
    await this.orgs.requireRole(orgId, userId, 'admin');
    if (!name?.trim()) throw new BadRequestException('Name is required');
    if (!this.isHttpsUrl(url)) {
      throw new BadRequestException('URL must be a valid http(s) URL');
    }
    const validEvents = this.normalizeSubscriptionEvents(events);
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    return this.webhookModel.create({
      orgId: new Types.ObjectId(orgId),
      createdBy: new Types.ObjectId(userId),
      name: name.trim(),
      url: url.trim(),
      events: validEvents,
      enabled: true,
      secret,
    });
  }

  async update(
    orgId: string,
    userId: string,
    webhookId: string,
    patch: Partial<{
      name: string;
      url: string;
      events: WebhookEventType[];
      enabled: boolean;
    }>,
  ): Promise<WebhookDocument> {
    await this.orgs.requireRole(orgId, userId, 'admin');
    if (!Types.ObjectId.isValid(webhookId)) {
      throw new NotFoundException('Webhook not found');
    }
    const updates: Record<string, unknown> = {};
    if (patch.name != null) updates.name = patch.name.trim();
    if (patch.url != null) {
      if (!this.isHttpsUrl(patch.url)) {
        throw new BadRequestException('URL must be a valid http(s) URL');
      }
      updates.url = patch.url.trim();
    }
    if (patch.events != null) {
      updates.events = this.normalizeSubscriptionEvents(patch.events);
    }
    if (patch.enabled != null) updates.enabled = patch.enabled;
    const updated = await this.webhookModel.findOneAndUpdate(
      { _id: new Types.ObjectId(webhookId), orgId: new Types.ObjectId(orgId) },
      { $set: updates },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Webhook not found');
    return updated;
  }

  async remove(
    orgId: string,
    userId: string,
    webhookId: string,
  ): Promise<void> {
    await this.orgs.requireRole(orgId, userId, 'admin');
    if (!Types.ObjectId.isValid(webhookId)) {
      throw new NotFoundException('Webhook not found');
    }
    const deleted = await this.webhookModel.deleteOne({
      _id: new Types.ObjectId(webhookId),
      orgId: new Types.ObjectId(orgId),
    });
    if (deleted.deletedCount === 0) {
      throw new NotFoundException('Webhook not found');
    }
  }

  async listDeliveries(
    orgId: string,
    userId: string,
    webhookId?: string,
    limit = 50,
  ): Promise<WebhookDeliveryDocument[]> {
    await this.orgs.requireMembership(orgId, userId);
    const filter: Record<string, unknown> = {
      orgId: new Types.ObjectId(orgId),
    };
    if (webhookId) {
      if (!Types.ObjectId.isValid(webhookId)) {
        throw new NotFoundException('Webhook not found');
      }
      filter.webhookId = new Types.ObjectId(webhookId);
    }
    return this.deliveryModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  async testFire(
    orgId: string,
    userId: string,
    webhookId: string,
  ): Promise<WebhookDeliveryDocument> {
    await this.orgs.requireRole(orgId, userId, 'admin');
    const hook = await this.webhookModel.findOne({
      _id: new Types.ObjectId(webhookId),
      orgId: new Types.ObjectId(orgId),
    });
    if (!hook) throw new NotFoundException('Webhook not found');
    const delivery = await this.deliveryModel.create({
      webhookId: hook._id,
      orgId: hook.orgId,
      event: 'project.updated' as WebhookEventType, // arbitrary canonical event
      eventId: `test_${crypto.randomUUID()}`,
      targetUrl: hook.url,
      payload: { test: true, sentAt: new Date().toISOString() },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    setImmediate(() => {
      void this.attemptDelivery(delivery._id.toString());
    });
    return delivery;
  }

  // ── Producer API (called from other services) ──────────────────

  /**
   * Resolve the user's active org and enqueue an event there. Tolerant of
   * users without an org (lazy migration) — falls back to a no-op so callers
   * never need to special-case unmigrated accounts.
   */
  async enqueueForUser(
    userId: string,
    event: WebhookEventType,
    payload: any,
  ): Promise<void> {
    try {
      const org = await this.orgs.ensurePersonalOrg(userId);
      await this.enqueue(String(org._id), event, payload);
    } catch (err) {
      this.logger.warn(
        `Skipped webhook ${event} for user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Persist + dispatch an event to every subscribed webhook in `orgId`.
   * Safe to fire-and-forget; errors are swallowed and logged.
   */
  async enqueue(
    orgId: string,
    event: WebhookEventType,
    payload: any,
    options: DispatchOptions = {},
  ): Promise<void> {
    try {
      const subs = await this.webhookModel
        .find({
          orgId: new Types.ObjectId(orgId),
          enabled: true,
          events: event,
        })
        .lean();
      if (subs.length === 0) return;

      const eventId = `evt_${crypto.randomUUID()}`;
      const baseDoc = {
        event,
        eventId,
        payload,
        status: 'pending' as const,
        attempts: 0,
        nextAttemptAt: new Date(),
      };

      const created = await this.deliveryModel.insertMany(
        subs.map((s) => ({
          ...baseDoc,
          webhookId: s._id,
          orgId: s.orgId,
          targetUrl: s.url,
        })),
      );

      if (options.immediate) {
        await Promise.all(
          created.map((d) => this.attemptDelivery(String(d._id))),
        );
      } else {
        for (const d of created) {
          setImmediate(() => void this.attemptDelivery(String(d._id)));
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to enqueue webhook event ${event} for org ${orgId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Dispatcher ─────────────────────────────────────────────────

  /**
   * Cron sweeper: picks up deliveries that are pending/failed past their
   * scheduled retry, or stuck in_flight (e.g. a worker crashed).
   *
   * Runs every minute. Tight budget per tick to avoid hot-looping mongo.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepPending(): Promise<void> {
    const now = new Date();
    const stuckCutoff = new Date(Date.now() - 5 * 60_000);
    const due = await this.deliveryModel
      .find({
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'failed', nextAttemptAt: { $lte: now } },
          { status: 'in_flight', updatedAt: { $lte: stuckCutoff } },
        ],
      })
      .limit(50)
      .select('_id')
      .lean();
    for (const d of due) {
      setImmediate(() => void this.attemptDelivery(String(d._id)));
    }
  }

  private async attemptDelivery(deliveryId: string): Promise<void> {
    let delivery: WebhookDeliveryDocument | null = null;
    try {
      delivery = await this.deliveryModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(deliveryId),
          status: { $in: ['pending', 'failed', 'in_flight'] },
        },
        { $set: { status: 'in_flight' } },
        { new: true },
      );
      if (!delivery) return;
      const hook = await this.webhookModel.findById(delivery.webhookId).lean();
      if (!hook || !hook.enabled) {
        delivery.status = 'dead';
        delivery.lastError = 'Webhook deleted or disabled';
        await delivery.save();
        return;
      }

      const body = JSON.stringify(delivery.payload);
      const ts = Math.floor(Date.now() / 1000);
      const signedPayload = `${ts}.${body}`;
      const signature = crypto
        .createHmac('sha256', hook.secret)
        .update(signedPayload)
        .digest('hex');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let res: Response;
      let responseText = '';
      try {
        res = await withObservability(
          'webhook.deliver',
          () =>
            fetch(delivery.targetUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'iyona-webhooks/1.0',
                'X-Iyona-Event': delivery.event,
                'X-Iyona-Event-Id': delivery.eventId,
                'X-Iyona-Timestamp': String(ts),
                'X-Iyona-Signature': `t=${ts},v1=${signature}`,
              },
              body,
              signal: controller.signal,
            }),
          {
            event: delivery.event,
            targetUrl: delivery.targetUrl,
            eventId: delivery.eventId,
          },
        );
        responseText = (await res.text()).slice(0, MAX_BODY_SAMPLE_BYTES);
      } finally {
        clearTimeout(timer);
      }

      delivery.attempts += 1;
      delivery.lastResponseStatus = res.status;
      delivery.lastResponseBody = responseText;

      if (res.status >= 200 && res.status < 300) {
        delivery.status = 'success';
        delivery.deliveredAt = new Date();
        delivery.lastError = null;
        await delivery.save();
        return;
      }

      delivery.lastError = `HTTP ${res.status}`;
      this.scheduleRetryOrDead(delivery);
      await delivery.save();
    } catch (err) {
      if (!delivery) return;
      delivery.attempts += 1;
      delivery.lastError =
        err instanceof Error ? err.message.slice(0, 1000) : String(err);
      this.scheduleRetryOrDead(delivery);
      await delivery.save().catch(() => {
        /* ignore */
      });
    }
  }

  /** Filters to `ALL_WEBHOOK_EVENTS`; throws if nothing remains (create/update parity). */
  private normalizeSubscriptionEvents(
    events: WebhookEventType[],
  ): WebhookEventType[] {
    const allowed = ALL_WEBHOOK_EVENTS as string[];
    const validEvents = events.filter((e) => allowed.includes(e));
    if (validEvents.length === 0) {
      throw new BadRequestException('At least one valid event is required');
    }
    return validEvents;
  }

  private scheduleRetryOrDead(delivery: WebhookDeliveryDocument): void {
    if (delivery.attempts >= MAX_ATTEMPTS) {
      delivery.status = 'dead';
      return;
    }
    const seconds =
      BACKOFF_SECONDS[delivery.attempts - 1] ??
      BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
    delivery.status = 'failed';
    delivery.nextAttemptAt = new Date(Date.now() + seconds * 1000);
  }

  private isHttpsUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }
}
