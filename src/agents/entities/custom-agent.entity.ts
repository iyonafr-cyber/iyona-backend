import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

/**
 * A user-defined "specialist" (custom slash-command agent). Each row is a
 * named set of instructions that the owning user can invoke in chat exactly
 * like a built-in agent — the `instructions` body is prepended as a `system`
 * message before the user's prompt.
 *
 * Slugs are unique **per user** (compound index below), so two different
 * users may each have a `/marketing` specialist without colliding. Built-in
 * agent slugs (developer, reviewer, seo) are reserved and rejected at the
 * service layer so a custom agent can never shadow a platform one.
 */
@Schema({ timestamps: true, collection: 'custom_agents' })
export class CustomAgent {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  /** URL/command-safe identifier, e.g. `marketing`. Unique per user. */
  @Prop({ type: String, required: true, trim: true, lowercase: true })
  slug!: string;

  /** Human-friendly display name shown in the picker, e.g. "Marketing Writer". */
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** One-line summary shown under the name in the picker. */
  @Prop({ type: String, default: '', trim: true })
  description?: string;

  /** Optional lucide icon name; the UI falls back to a default when unset. */
  @Prop({ type: String, default: 'sparkles', trim: true })
  icon?: string;

  /** The specialist's system prompt — the actual instructions body. */
  @Prop({ type: String, required: true })
  instructions!: string;
}

export type CustomAgentDocument = CustomAgent & Document;
export const CustomAgentSchema = SchemaFactory.createForClass(CustomAgent);
CustomAgentSchema.index({ userId: 1, slug: 1 }, { unique: true });
