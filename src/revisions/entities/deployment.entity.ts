import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export enum DeploymentStatus {
  QUEUED = 'QUEUED',
  BUILDING = 'BUILDING',
  READY = 'READY',
  ERROR = 'ERROR', // legacy — still written by old code paths; mapped to FAILED at API layer
  CANCELED = 'CANCELED',
  /** AI fix in progress after a Vercel build failure; redeploying silently. */
  REPAIRING = 'REPAIRING',
  FAILED = 'FAILED', // terminal failure — replaces ERROR at the API layer
}

@Schema({ timestamps: true })
export class Deployment extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Revision',
    required: true,
    index: true,
  })
  revisionId: mongoose.Types.ObjectId;

  /** Vercel deployment ID. Null during QUEUED phase (pre-Vercel work still running). */
  @Prop({ type: String, required: false })
  vercelDeploymentId?: string;

  @Prop({
    type: String,
    enum: DeploymentStatus,
    default: DeploymentStatus.QUEUED,
  })
  status: DeploymentStatus;

  @Prop({ type: String, required: false })
  deploymentUrl?: string;

  @Prop({ type: String, required: false })
  previewUrl?: string;

  @Prop({ type: String, required: false })
  alias?: string;

  @Prop({ type: String, required: false })
  errorMessage?: string;

  @Prop({ type: Date, required: false })
  readyAt?: Date;

  @Prop({ type: Date, required: false })
  failedAt?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  buildLogs?: string[];

  @Prop({ type: String, required: false })
  customDomain?: string;

  /**
   * Pinned commit SHA on GitHub `main` that was used for this deployment.
   * Set when the deploy pipeline reads the tree from GitHub before uploading
   * to Vercel. Null on legacy deployments that predate the GitHub pipeline.
   */
  @Prop({ type: String, required: false })
  commitSha?: string;

  /**
   * How many Cursor rounds (cleanup + repair) were executed for this deployment.
   * 0 = Vercel build succeeded on the first attempt after cleanup.
   */
  @Prop({ type: Number, default: 0 })
  cursorRoundCount: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, any>;

  // Populated by `timestamps: true`; declared so filters/sorts on them type-check.
  createdAt?: Date;
  updatedAt?: Date;
}

export const DeploymentSchema = SchemaFactory.createForClass(Deployment);

// Create compound indexes
DeploymentSchema.index({ projectId: 1, createdAt: -1 });
DeploymentSchema.index(
  { vercelDeploymentId: 1 },
  { unique: true, sparse: true }, // sparse so null/undefined docs don't conflict
);
