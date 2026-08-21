import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** Background workspace edit pipeline (async after HTTP 202). */
export enum WorkspaceCursorJobStatus {
  QUEUED = 'QUEUED',
  RUNNING_AGENT = 'RUNNING_AGENT',
  DEPLOYING = 'DEPLOYING',
  COMPLETED = 'COMPLETED',
  /**
   * Terminal success with nothing to deploy: the message was a question, so the
   * agent replied instead of changing code. `agentMessage` holds the answer.
   */
  ANSWERED = 'ANSWERED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class WorkspaceCursorJob extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: mongoose.Types.ObjectId;

  /** User prompt (bounded same as controller). */
  @Prop({ type: String, required: true })
  prompt: string;

  @Prop({ type: String, default: 'vite' })
  framework: string;

  @Prop({
    type: String,
    enum: WorkspaceCursorJobStatus,
    default: WorkspaceCursorJobStatus.QUEUED,
    index: true,
  })
  status: WorkspaceCursorJobStatus;

  /**
   * Presigned S3 URLs for images attached to the prompt. URLs, not bytes:
   * the run starts minutes after enqueue, and parking megabytes of base64 on
   * the job row for that whole window helps nobody.
   */
  @Prop({ type: [String], required: false })
  promptImageUrls?: string[];

  /** Safe for API responses — never raw GitHub/Cursor internals. */
  @Prop({ type: String, required: false })
  errorMessage?: string;

  /** The agent's final reply, shown in chat (the answer when status is ANSWERED). */
  @Prop({ type: String, required: false })
  agentMessage?: string;

  @Prop({ type: String, required: false })
  mergedSha?: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Revision',
    required: false,
  })
  revisionId?: mongoose.Types.ObjectId;

  /** Present when deploy pipeline has started — client polls deployment progress. */
  @Prop({ type: String, required: false })
  deploymentId?: string;

  @Prop({ type: String, required: false })
  deployStatus?: string;

  /**
   * Credit reservation taken at enqueue time (the full `Reservation` object).
   * Committed when the job succeeds, refunded when it fails. Persisted so the
   * async processor — and the stale-job reaper — can settle it after a crash.
   */
  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  creditReservation?: Record<string, unknown>;

  /** True once the reservation above has been committed or refunded exactly once. */
  @Prop({ type: Boolean, default: false })
  creditSettled?: boolean;

  // Populated by `timestamps: true`; declared so filters/sorts on them type-check.
  createdAt?: Date;
  updatedAt?: Date;
}

export const WorkspaceCursorJobSchema =
  SchemaFactory.createForClass(WorkspaceCursorJob);

WorkspaceCursorJobSchema.index({
  projectId: 1,
  status: 1,
  createdAt: -1,
});
