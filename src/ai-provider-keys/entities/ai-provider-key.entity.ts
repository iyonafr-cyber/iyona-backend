import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AiProviderKeyProvider = 'openai' | 'anthropic' | 'google';

export type AiProviderKeyHealthStatus =
  | 'healthy'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'disabled'
  | 'invalid';

/**
 * Platform-managed LLM provider credentials. Raw keys are stored encrypted
 * (`apiKeyEnc`); `keyPreview` is safe to show in admin UI.
 */
@Schema({ timestamps: true, collection: 'ai_provider_keys' })
export class AiProviderKey extends Document {
  @Prop({
    type: String,
    required: true,
    enum: ['openai', 'anthropic', 'google'],
    index: true,
  })
  provider: AiProviderKeyProvider;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  /** AES-encrypted secret (never returned from APIs). */
  @Prop({ type: String, required: true })
  apiKeyEnc: string;

  /** Mask like `sk-a...xYz` for admin list UI. */
  @Prop({ type: String, required: true })
  keyPreview: string;

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  /** Lower sorts first (higher priority). */
  @Prop({ type: Number, default: 100, index: true })
  priority: number;

  /** Empty = supports any model id for this provider. */
  @Prop({ type: [String], default: [] })
  supportedModels: string[];

  @Prop({
    type: String,
    enum: ['healthy', 'rate_limited', 'quota_exceeded', 'disabled', 'invalid'],
    default: 'healthy',
    index: true,
  })
  healthStatus: AiProviderKeyHealthStatus;

  @Prop({ type: Date, required: false })
  lastFailureAt?: Date;

  @Prop({ type: String, required: false })
  lastFailureReason?: string;

  @Prop({ type: Number, default: 0 })
  consecutiveFailures: number;

  /** Optional OpenAI-compatible API base (OpenAI provider only). */
  @Prop({ type: String, required: false })
  openaiBaseUrl?: string;

  @Prop({ type: Number, default: 0 })
  totalRequests: number;

  @Prop({ type: String, required: false })
  usageDay?: string;

  @Prop({ type: Number, default: 0 })
  requestsToday: number;

  @Prop({ type: String, required: false })
  usageMinuteBucket?: string;

  @Prop({ type: Number, default: 0 })
  requestsThisMinute: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
  })
  createdBy?: Types.ObjectId | null;
}

export const AiProviderKeySchema = SchemaFactory.createForClass(AiProviderKey);

AiProviderKeySchema.index({
  provider: 1,
  isActive: 1,
  healthStatus: 1,
  priority: 1,
});
AiProviderKeySchema.index({ provider: 1, supportedModels: 1 });
