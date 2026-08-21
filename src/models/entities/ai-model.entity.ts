import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ModelProvider = 'openai' | 'anthropic' | 'google';
export type ModelTier = 'high' | 'medium' | 'low';

/**
 * High-level capability bucket. Used to filter the user-facing model
 * picker so non-coding models (image generation, content writing) don't
 * appear in places that send a coding prompt. Admins can change this on
 * any row from the /admin/models UI.
 */
export type ModelCategory = 'coding' | 'image' | 'content';

export const MODEL_CATEGORIES: ReadonlyArray<ModelCategory> = [
  'coding',
  'image',
  'content',
];

/**
 * Catalog of AI models available to users in the model picker. Seeded on
 * boot from `model-catalog.seed.ts` and editable by admins via the
 * `/admin/models` API. Pricing lives here too so future pricing changes
 * don't require a code redeploy — the router snapshots the full row at
 * the request boundary and uses it for billing.
 *
 * One row has `isDefault: true` — that's the model "Auto" resolves to
 * when nothing more specific is requested.
 */
@Schema({ timestamps: true, collection: 'ai_models' })
export class AiModel extends Document {
  @Prop({ type: String, required: true, unique: true, index: true })
  modelId: string;

  @Prop({
    type: String,
    required: true,
    enum: ['openai', 'anthropic', 'google'],
  })
  provider: ModelProvider;

  @Prop({ type: String, required: true })
  displayName: string;

  @Prop({
    type: String,
    required: true,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  })
  tier: ModelTier;

  @Prop({
    type: String,
    required: true,
    enum: ['coding', 'image', 'content'],
    default: 'coding',
    index: true,
  })
  category: ModelCategory;

  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  isDefault: boolean;

  @Prop({ type: Number, default: 0 })
  order: number;

  @Prop({ type: Number, required: true, default: 0 })
  inputPerMillion: number;

  @Prop({ type: Number, required: true, default: 0 })
  outputPerMillion: number;

  @Prop({ type: Number, required: true, default: 4000 })
  maxOutputTokens: number;

  @Prop({ type: Number, required: true, default: 128000 })
  contextTokens: number;

  @Prop({ type: Boolean, default: true })
  codingOptimized: boolean;

  @Prop({ type: Date, required: false })
  deprecatedAt?: Date;

  @Prop({ type: Date, required: false })
  lastSeenAt?: Date;

  /**
   * When the provider published this model. Captured during catalog refresh
   * from the provider's own metadata — Anthropic's `created_at`, OpenAI's
   * `created` epoch. Google's list endpoint publishes no date, so Gemini rows
   * stay undefined and consumers fall back to ordering by model id.
   *
   * Provider-owned, unlike the admin-managed columns: refresh overwrites it
   * on every run rather than only on insert.
   */
  @Prop({ type: Date, required: false })
  releasedAt?: Date;
}

export const AiModelSchema = SchemaFactory.createForClass(AiModel);
