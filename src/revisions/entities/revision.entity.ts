import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export enum RevisionStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED',
}

/** Why a revision ended in FAILED (optional; for analytics and UI messaging). */
export enum RevisionFailureReason {
  VALIDATION = 'VALIDATION',
  DEPLOY = 'DEPLOY',
  /** Vercel or compile-time build failure (historical rows may still use this value). */
  BUILD = 'BUILD',
  /** Cursor cleanup or repair round itself errored (not a Vercel build failure). */
  CURSOR_FAILED = 'CURSOR_FAILED',
  /** All 3 Vercel-build-fail → Cursor-repair iterations used up. */
  CURSOR_EXHAUSTED = 'CURSOR_EXHAUSTED',
  /** Vercel build failed after exhausting Cursor repair rounds. */
  VERCEL_BUILD = 'VERCEL_BUILD',
  /** We stopped waiting on a Vercel build that never reached a terminal state. */
  VERCEL_TIMEOUT = 'VERCEL_TIMEOUT',
  /** The Vercel deployment was canceled (by Vercel or a superseding deploy). */
  VERCEL_CANCELED = 'VERCEL_CANCELED',
}

export type CursorRoundStatus =
  | 'running'
  | 'merged'
  | 'no_changes'
  | 'stalemate'
  | 'failed';

export type CursorRoundKind = 'cleanup' | 'repair';

/** Structured validation errors stored on a failed revision (optional). */
export interface RevisionValidationError {
  message: string;
  file?: string;
  field?: string;
}

@Schema({ timestamps: true })
export class Revision extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({ type: Number, required: true })
  version: number;

  /**
   * Legacy S3 key — present on revisions created before the GitHub-canonical
   * pipeline. No longer written by new code; kept so old docs remain readable.
   */
  @Prop({ type: String, required: false })
  s3Key?: string;

  /**
   * Commit SHA on `main` immediately after the AI generation tree was pushed.
   * This is the input SHA before any Cursor rounds.
   */
  @Prop({ type: String, required: false })
  initialCommitSha?: string;

  /**
   * Commit SHA that was actually sent to Vercel (after cleanup + repair rounds).
   * Pinned at deploy time so re-deploys are reproducible.
   */
  @Prop({ type: String, required: false })
  deployCommitSha?: string;

  /**
   * Ordered log of every Cursor agent round for this revision.
   * attempt=0 → cleanup (always runs before first Vercel deploy).
   * attempt=1..3 → repair rounds triggered by Vercel build failures.
   */
  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  cursorRounds: Array<{
    attempt: number;
    kind: CursorRoundKind;
    branch: string;
    agentId?: string;
    runId?: string;
    prNumber?: number;
    prUrl?: string;
    baseSha: string;
    mergedSha?: string;
    vercelBuildErrorTail?: string;
    status: CursorRoundStatus;
    startedAt: Date;
    endedAt?: Date;
  }>;

  @Prop({ type: Number, required: true, default: 0 })
  fileCount: number;

  @Prop({
    type: String,
    enum: RevisionStatus,
    default: RevisionStatus.PENDING,
  })
  status: RevisionStatus;

  @Prop({ type: String, required: false })
  deploymentId?: string;

  @Prop({ type: String, required: false })
  deploymentUrl?: string;

  @Prop({ type: String, required: false })
  previewUrl?: string;

  @Prop({ type: String, required: false })
  errorMessage?: string;

  @Prop({
    type: String,
    enum: RevisionFailureReason,
    required: false,
  })
  failureReason?: RevisionFailureReason;

  @Prop({ type: [mongoose.Schema.Types.Mixed], required: false })
  validationErrors?: RevisionValidationError[];

  @Prop({ type: String, required: false })
  commitMessage?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, any>;
}

export const RevisionSchema = SchemaFactory.createForClass(Revision);

// Compound index for efficient "latest revision" queries. UNIQUE so two
// concurrent creators (double-click, or two replicas) can never mint the same
// version number — the loser gets an E11000 and retries with version+1 (see
// RevisionsService.createRevisionForProject).
RevisionSchema.index({ projectId: 1, version: -1 }, { unique: true });
