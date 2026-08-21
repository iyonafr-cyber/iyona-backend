import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/**
 * Per-project log of runtime errors captured by the preview-bridge
 * inside the deployed app's iframe (E3).
 *
 * Stored as a separate collection rather than as an embedded array on
 * `UserProject` because:
 *   - error volume can spike during early development of a project,
 *   - we want to query by time/kind/fingerprint without paging the
 *     full project document,
 *   - and we want a TTL index so old errors are pruned automatically
 *     without bloating the main doc.
 */
export enum ProjectErrorKind {
  RUNTIME = 'runtime',
  UNHANDLED_REJECTION = 'unhandledrejection',
  CONSOLE_ERROR = 'console.error',
  CONSOLE_WARN = 'console.warn',
}

export enum ProjectErrorStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  RESOLVED = 'resolved',
}

@Schema({ timestamps: true, collection: 'project_errors' })
export class ProjectError {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId!: mongoose.Types.ObjectId;

  /**
   * Whoever was driving the preview when the error fired. We log it
   * to give chat replies "context": "this happened to <user>".
   */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  })
  reportedBy?: mongoose.Types.ObjectId | null;

  /** Which deployment was active. Helps correlate with revisions. */
  @Prop({ type: String, required: false })
  revisionId?: string;

  @Prop({ type: String, enum: ProjectErrorKind, required: true, index: true })
  kind!: ProjectErrorKind;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: String, required: false })
  stack?: string;

  @Prop({ type: String, required: false })
  source?: string;

  @Prop({ type: Number, required: false })
  line?: number;

  @Prop({ type: Number, required: false })
  col?: number;

  /** URL of the page in the iframe at the time of the error. */
  @Prop({ type: String, required: false })
  pageUrl?: string;

  /** User agent string for "works on my machine" debugging. */
  @Prop({ type: String, required: false })
  userAgent?: string;

  /**
   * Stable hash so we can group "same error fired N times" without a
   * full text search. Built from kind + message + first stack line.
   */
  @Prop({ type: String, required: true, index: true })
  fingerprint!: string;

  @Prop({ type: Number, default: 1 })
  occurrences!: number;

  @Prop({ type: Date, default: () => new Date() })
  firstSeenAt!: Date;

  @Prop({ type: Date, default: () => new Date(), index: true })
  lastSeenAt!: Date;

  @Prop({
    type: String,
    enum: ProjectErrorStatus,
    default: ProjectErrorStatus.OPEN,
    index: true,
  })
  status!: ProjectErrorStatus;

  /** Becomes true once the user clicked "Send to Iyona" on this row. */
  @Prop({ type: Boolean, default: false })
  sentToChat!: boolean;
}

export type ProjectErrorDocument = ProjectError & Document;
export const ProjectErrorSchema = SchemaFactory.createForClass(ProjectError);

// Compound index for the main "list errors for this project, newest first" query.
ProjectErrorSchema.index({ projectId: 1, lastSeenAt: -1 });
// Auto-prune after 30 days. Most preview errors stop being useful long
// before then; raise via env if customers want longer retention.
ProjectErrorSchema.index(
  { lastSeenAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);
