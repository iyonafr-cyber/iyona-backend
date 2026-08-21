import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
import type { WebhookEventType } from './webhook.entity';

export type WebhookDeliveryStatus =
  | 'pending'
  | 'in_flight'
  | 'success'
  | 'failed'
  | 'dead';

/**
 * One outbox entry per (webhook × event). Persisted before the HTTP attempt
 * so retries survive a crash. The dispatcher drains pending rows on a cron.
 */
@Schema({ timestamps: true, collection: 'webhook_deliveries' })
export class WebhookDelivery {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Webhook',
    required: true,
    index: true,
  })
  webhookId!: Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  event!: WebhookEventType;

  /** Stable id per emitted event so receivers can dedupe. */
  @Prop({ type: String, required: true, index: true })
  eventId!: string;

  /** Snapshot of the URL at dispatch time (in case the webhook is later edited). */
  @Prop({ type: String, required: true })
  targetUrl!: string;

  /** JSON payload as we attempted to send it. */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  payload!: any;

  @Prop({
    type: String,
    enum: ['pending', 'in_flight', 'success', 'failed', 'dead'],
    default: 'pending',
    index: true,
  })
  status!: WebhookDeliveryStatus;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: () => new Date(), index: true })
  nextAttemptAt?: Date;

  @Prop({ type: Number, default: null })
  lastResponseStatus?: number | null;

  @Prop({ type: String, default: null, maxlength: 4000 })
  lastResponseBody?: string | null;

  @Prop({ type: String, default: null, maxlength: 1000 })
  lastError?: string | null;

  @Prop({ type: Date, default: null })
  deliveredAt?: Date | null;
}

export type WebhookDeliveryDocument = WebhookDelivery & Document;
export const WebhookDeliverySchema =
  SchemaFactory.createForClass(WebhookDelivery);
