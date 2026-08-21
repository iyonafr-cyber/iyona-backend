import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Per-request AI usage record. Written once per billable action after the
 * underlying provider call completes (success or failure). Never mutated —
 * it's an audit trail used for margin analysis and debugging cost anomalies.
 *
 * The `requestId` field is the idempotency key (propagated from
 * `x-request-id` / pino's genReqId) so retries of the same user action can
 * be correlated even when they hit different replicas.
 */
@Schema({ timestamps: true, collection: 'usage_logs' })
export class UsageLog extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null, index: true })
  projectId: string | null;

  /**
   * Action tag (matches the `@CreditAction` key). Examples: 'validate',
   * 'generate_full_app', 'modify_code', 'patch_apply'.
   */
  @Prop({ type: String, required: true, index: true })
  action: string;

  @Prop({ type: String, required: true })
  provider: 'openai' | 'anthropic';

  // NOTE: called `modelName` (not `model`) because mongoose's `Document`
  // reserves `model` on the prototype — extending Document with a `model`
  // field shadows `this.model()` and breaks typings.
  @Prop({ type: String, required: true })
  modelName: string;

  @Prop({ type: Number, default: 0 })
  inputTokens: number;

  @Prop({ type: Number, default: 0 })
  outputTokens: number;

  /** Actual USD cost computed from provider pricing. Never shown to users. */
  @Prop({ type: Number, default: 0 })
  actualCostUsd: number;

  /** Credits reserved upfront (upper bound). */
  @Prop({ type: Number, default: 0 })
  creditsReserved: number;

  /** Credits actually committed after the call. */
  @Prop({ type: Number, default: 0 })
  creditsCharged: number;

  @Prop({
    type: String,
    enum: ['success', 'error', 'timeout', 'aborted'],
    default: 'success',
    index: true,
  })
  status: 'success' | 'error' | 'timeout' | 'aborted';

  @Prop({ type: String, default: null })
  errorMessage: string | null;

  @Prop({ type: Number, default: 0 })
  durationMs: number;

  @Prop({ type: String, required: true, index: true })
  requestId: string;
}

export const UsageLogSchema = SchemaFactory.createForClass(UsageLog);
UsageLogSchema.index({ userId: 1, createdAt: -1 });
UsageLogSchema.index({ userId: 1, action: 1, createdAt: -1 });
