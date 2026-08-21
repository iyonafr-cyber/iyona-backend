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
