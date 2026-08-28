import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Singleton admin-controlled configuration. We always use `_id: 'singleton'`
 * so there's at most one row — upserts key off that id. We do NOT extend
 * mongoose's `Document` so we can redefine `_id` as a string.
 */
@Schema({
  timestamps: true,
  collection: 'admin_settings',
  _id: false,
})
export class AdminSettings {
  @Prop({ type: String, default: 'singleton' })
  _id: string;

  @Prop({ type: Boolean, default: false })
  maintenanceMode: boolean;

  @Prop({ type: String, default: null })
  maintenanceMessage: string | null;

  /**
   * Model the Cursor Cloud Agent uses to author application code.
   *
   * Separate from the model catalogue on purpose: catalogue ids
   * (`claude-opus-4-7`, `gemini-3-1-high`) are OUR namespace and drive
   * LlmService — planning, validation, questionnaires. Cursor has its own
   * model ids and is the only thing that writes code, so "the default model
   * for coding" has to be stored and validated against Cursor's list.
   *
   * null → fall back to CURSOR_AGENT_MODEL_ID, then 'composer-2'.
   */
  @Prop({ type: String, default: null })
  cursorAgentModelId: string | null;

  /**
   * Model parameters for the Cursor coding model — effort/reasoning/thinking/
   * fast, as `{ paramId: value }` (e.g. `{ effort: 'high', fast: 'true' }`).
   * Valid ids/values come from Cursor's live catalogue (GET /v1/models),
   * which the admin dashboard renders as dropdowns — so what is stored here
   * was picked from what Cursor actually accepts at the time of saving.
   * Only applied when cursorAgentModelId is also set; null → model defaults.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  cursorAgentModelParams: Record<string, string> | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  updatedBy: Types.ObjectId | null;
}

export const AdminSettingsSchema = SchemaFactory.createForClass(AdminSettings);
