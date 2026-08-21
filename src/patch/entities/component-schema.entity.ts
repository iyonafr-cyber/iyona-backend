import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

/**
 * Patch types that the engine can handle
 */
export enum PatchType {
  PROPERTY = 'property', // Text, color, image change
  LAYOUT = 'layout', // Component layout regenerated
  TREE = 'tree', // Add/remove sections
  REPLACEMENT = 'replacement', // Full component replacement
}

/**
 * Component types that can exist in a project
 */
export enum ComponentType {
  PAGE = 'page',
  COMPONENT = 'component',
  LAYOUT = 'layout',
  HOOK = 'hook',
  UTILITY = 'utility',
  CONFIG = 'config',
  STYLE = 'style',
}

/**
 * A single version snapshot of a component's configuration
 */
@Schema({ _id: false })
export class ComponentVersion {
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

  @Prop({ type: String, required: false })
  commitMessage?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

/**
 * ComponentSchema — The source of truth for each component in a project.
 *
 * Generated code is derived from this schema; the schema itself
 * is the authoritative representation of the component.
 */
@Schema({ timestamps: true })
export class ComponentSchema extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true })
  componentId: string;

  @Prop({
    type: String,
    enum: ComponentType,
    required: true,
  })
  type: ComponentType;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({ type: String, required: false })
  pageName?: string;

  @Prop({ type: String, required: true })
  filePath: string;

  @Prop({ type: [String], default: [] })
  dependencies: string[];

  // Current configuration (latest version)
  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  props: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  styles: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  layout: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  content: Record<string, any>;

  // Current generated code for this component
  @Prop({ type: String, required: false })
  generatedCode?: string;

  // Version tracking
  @Prop({ type: Number, default: 1 })
  version: number;

  @Prop({ type: [ComponentVersion], default: [] })
  versionHistory: ComponentVersion[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, any>;
}

export const ComponentSchemaModel =
  SchemaFactory.createForClass(ComponentSchema);

// Compound index for efficient lookups
ComponentSchemaModel.index({ projectId: 1, componentId: 1 }, { unique: true });
ComponentSchemaModel.index({ projectId: 1, type: 1 });
