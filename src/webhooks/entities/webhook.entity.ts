import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type WebhookEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'project.restored'
  | 'project.deployed'
  | 'patch.applied'
  | 'build.succeeded'
  | 'build.failed';

export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = [
  'project.created',
  'project.updated',
  'project.deleted',
  'project.restored',
  'project.deployed',
  'patch.applied',
  'build.succeeded',
  'build.failed',
];

/**
 * Org-scoped outbound webhook (E12).
 *
 * - `secret` is generated once on creation; we keep the plaintext on the
 *   document because the user needs it to verify signatures on their side.
 *   It is exposed only to org admins (same blast-radius rule as API keys).
 * - `events` is the subscription list. The dispatcher fans out an event to
 *   every webhook whose `events` includes it AND `enabled === true`.
 */
@Schema({ timestamps: true, collection: 'webhooks' })
export class Webhook {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 2048 })
  url!: string;

  @Prop({
    type: [String],
    enum: ALL_WEBHOOK_EVENTS,
    default: [],
  })
  events!: WebhookEventType[];

  /**
   * Random secret used to compute HMAC-SHA256 signatures over delivery
   * bodies. Receivers verify with the same secret.
   */
  @Prop({ type: String, required: true })
  secret!: string;

  @Prop({ type: Boolean, default: true, index: true })
  enabled!: boolean;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  createdBy!: Types.ObjectId;
}

export type WebhookDocument = Webhook & Document;
export const WebhookSchema = SchemaFactory.createForClass(Webhook);
