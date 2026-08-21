import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Chat extends Document {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProject',
    required: true,
    index: true,
  })
  projectId: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({
    type: String,
    enum: ['user', 'assistant'],
    default: 'user',
  })
  role: string;

  @Prop({
    type: String,
    enum: [
      'markdown',
      'deployment',
      'code-generation',
      'questionnaire',
      'execution-plan',
      'patch-update',
    ],
    required: false,
  })
  messageType?: string;

  @Prop({
    type: mongoose.Schema.Types.Mixed,
    required: false,
  })
  metadata?: Record<string, any>;

  /**
   * Stable position in the transcript. `createdAt` can't be the sort key
   * once messages are editable: an edited message gets a fresh `createdAt`
   * and would teleport to the bottom of the chat. Every version of a
   * message shares its original's `orderKey`, so re-running a prompt keeps
   * it where the user wrote it. Spaced by 1000 to leave room for inserts.
   */
  @Prop({ type: Number, required: true, default: 0 })
  orderKey: number;

  /** 1-based version at this `orderKey`. Bumped on each edit. */
  @Prop({ type: Number, default: 1 })
  version: number;

  /**
   * Only `active` messages are part of the live transcript. Editing never
   * deletes: superseded messages stay in the collection so a branch can be
   * swapped back in.
   */
  @Prop({ type: Boolean, default: true, index: true })
  active: boolean;

  /** The message this one replaces (same `orderKey`, lower `version`). */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: false,
  })
  revisionOf?: mongoose.Types.ObjectId;

  /**
   * Set on every message archived by a single edit — the id of the new
   * message that caused the archival. This is what makes branch restore a
   * one-liner: all docs sharing a `supersededBy` value were archived
   * together, so they are exactly one branch tail and come back together.
   */
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: false,
    index: true,
  })
  supersededBy?: mongoose.Types.ObjectId | null;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);

// The live-transcript read path:
// Chat.find({ projectId, active: true }).sort({ orderKey: 1 })
ChatSchema.index({ projectId: 1, active: 1, orderKey: 1 });

// Version stack for a single bubble (the ‹ 2/3 › picker) and the
// next-orderKey probe on create.
ChatSchema.index({ projectId: 1, orderKey: 1, version: 1 });
