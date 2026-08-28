import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/** Background spec→Cursor initial build (async after HTTP 202). */
export enum SpecBuildJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  DEPLOYING = 'DEPLOYING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class SpecBuildJob extends Document {
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

  @Prop({ type: String, required: true })
  projectIdea: string;

  @Prop({ type: Object, default: {} })
  answers: Record<string, unknown>;

  @Prop({ type: Object, required: false })
  questionLabels?: Record<string, string>;

  @Prop({
    type: String,
    enum: SpecBuildJobStatus,
    default: SpecBuildJobStatus.QUEUED,
    index: true,
  })
  status: SpecBuildJobStatus;

  @Prop({ type: String, required: false })
  errorMessage?: string;

  /** Cursor merge outcome from SpecBuildService. */
  @Prop({ type: String, required: false })
  buildStatus?: string;

  @Prop({ type: String, required: false })
  mergedSha?: string;

  @Prop({ type: String, required: false })
  prUrl?: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Revision',
    required: false,
  })
  revisionId?: mongoose.Types.ObjectId;

  @Prop({ type: String, required: false })
  deploymentId?: string;

  @Prop({ type: String, required: false })
  deployStatus?: string;

  /** UX: paths to rotate on the loading screen after the brief is ready. */
  @Prop({ type: [String], default: [] })
  loadingFiles: string[];

  /**
   * The FULL DEVELOPMENT PLAN the LLM "brain" wrote for this build.
   *
   * Kept so a disappointing app can be traced back to the instruction that
   * produced it: nearly every output problem we have chased (same layout
   * everywhere, off-topic imagery, a 10-page app for a "simple" request) was a
   * defect in this text rather than in the agent. Without it, diagnosis means
   * guessing at a prompt that was never recorded.
   *
   * Admin-only; never returned on a user-facing endpoint.
   */
  @Prop({ type: String, required: false, select: false })
  brief?: string;

  /**
   * The exact prompt handed to the Cursor agent: worker task + per-project
   * design context + the plan above. Stored separately from `brief` because
   * the static task and the design context are what the plan does NOT say, and
   * that difference is usually where the answer is.
   *
   * `select: false` on both — these run tens of KB each and must never load on
   * an ordinary job read (status polling hits this collection constantly).
   */
  @Prop({ type: String, required: false, select: false })
  agentPrompt?: string;

  @Prop({ type: Object, required: false })
  estimate?: {
    buildSeconds: number;
    tokens: number;
    fileCount: number;
  };

  // Populated by `timestamps: true`; declared so filters/sorts on them type-check.
  createdAt?: Date;
  updatedAt?: Date;
}

export const SpecBuildJobSchema = SchemaFactory.createForClass(SpecBuildJob);

SpecBuildJobSchema.index({ projectId: 1, status: 1, createdAt: -1 });
