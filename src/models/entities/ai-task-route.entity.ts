import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * The internal work-unit an AI call belongs to. Every call site declares one
 * (see `AiService.actionToRouterTask`) and the router turns it into a
 * concrete provider + model.
 *
 * Declared here rather than in `credits/model-router.service` so the models
 * module can own the admin-facing routing config without importing from
 * `credits` — `credits` already imports `models`, and the reverse edge would
 * close a cycle.
 */
export type RouterTaskName =
  | 'classify'
  | 'plan'
  | 'reason'
  | 'extract';

export const ROUTER_TASKS: ReadonlyArray<RouterTaskName> = [
  'classify',
  'plan',
  'reason',
  'extract',
];

/**
 * Human-facing blurb per task, surfaced in the admin UI so whoever is
 * configuring routing knows what each task actually drives.
 */
export const ROUTER_TASK_DESCRIPTIONS: Record<RouterTaskName, string> = {
  plan: 'Development plan for new builds (the "brain" pass handed to Cursor) and execution plans.',
  classify: 'Idea validation, questionnaires, and chat prompt classification.',
  extract: 'Structured field extraction from user text.',
  reason: 'Open-ended reasoning that is not code authorship.',
};

/**
 * Admin-controlled routing for one {@link RouterTaskName}.
 *
 * `primaryModelId` is tried first; each entry of `fallbackModelIds` is tried
 * in order after it. A candidate is skipped when the model is missing from
 * the catalog, disabled, or its provider has no healthy key — so a dead
 * provider degrades down the chain instead of failing the request.
 *
 * When every candidate is unavailable the router falls through to its
 * pre-existing behaviour (global default model, then the built-in per-task
 * candidate table), so a misconfigured row can never take the platform down.
 */
@Schema({ timestamps: true, collection: 'ai_task_routes' })
export class AiTaskRoute extends Document {
  @Prop({
    type: String,
    required: true,
    unique: true,
    index: true,
    enum: ROUTER_TASKS as unknown as string[],
  })
  task: RouterTaskName;

  /** First choice. `null` = not configured; the row is then inert. */
  @Prop({ type: String, default: null })
  primaryModelId: string | null;

  /** Ordered secondary chain, tried left to right after the primary. */
  @Prop({ type: [String], default: [] })
  fallbackModelIds: string[];

  /**
   * When true this route also overrides the per-request model picker and the
   * per-project default — use it for tasks where model choice is a platform
   * quality concern rather than a user preference (the dev plan, typically).
   * When false the route only outranks the global "Auto" default.
   */
  @Prop({ type: Boolean, default: false })
  enforce: boolean;

  /** Master switch. Disabled rows are ignored entirely. */
  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
  })
  updatedBy: Types.ObjectId | null;
}

export const AiTaskRouteSchema = SchemaFactory.createForClass(AiTaskRoute);
