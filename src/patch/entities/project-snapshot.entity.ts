import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/**
 * Embedded component snapshot — a lightweight copy of ComponentSchema
 * stored within a project snapshot for full state restoration.
 */
@Schema({ _id: false })
export class ComponentSnapshot {
  @Prop({ type: String, required: true })
  componentId: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  filePath: string;

  @Prop({ type: Number, required: true })
  version: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  props: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  styles: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  layout: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  content: Record<string, any>;

  @Prop({ type: String, required: false })
  generatedCode?: string;
}

/**
 * ProjectSnapshot — Captures the full project schema state at a point in time.
 *
 * Like a Git commit: stores all component configurations so the entire
 * project can be restored to this exact state.
 */
@Schema({ timestamps: true })
export class ProjectSnapshot extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({ type: Number, required: true })
  snapshotVersion: number;

  @Prop({ type: [ComponentSnapshot], default: [] })
  componentSchemas: ComponentSnapshot[];

  @Prop({ type: String, required: false })
  commitMessage?: string;

  @Prop({ type: String, required: false })
  s3Key?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, any>;
}

export const ProjectSnapshotModel =
  SchemaFactory.createForClass(ProjectSnapshot);

// Compound index for efficient lookups
ProjectSnapshotModel.index(
  { projectId: 1, snapshotVersion: -1 },
  { unique: true },
);
