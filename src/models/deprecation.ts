import { ModelProvider } from './entities/ai-model.entity';
import { RETIRED_MODEL_IDS } from './model-catalog.seed';

export interface DeprecationCandidate {
  modelId: string;
  provider: ModelProvider;
  enabled: boolean;
  deprecatedAt?: Date | null;
}

export interface DeprecationPlan {
  /** Rows to stamp `deprecatedAt` on — their provider stopped listing them. */
  deprecate: string[];
  /** Rows to clear `deprecatedAt` on — their provider lists them again. */
  restore: string[];
  /**
   * Enabled rows the provider no longer lists. A subset of the catalog that
   * overlaps `deprecate`, reported separately because it is the only part
   * that needs a human: these were sellable until this refresh, so they may
   * be a task-route primary or a project default.
   */
  stale: string[];
}

/**
 * Decide which catalog rows a refresh should retire or revive.
 *
 * Extracted as a pure function because the interesting cases are all about
 * *absence* — a provider that didn't answer, a row nobody has seen for a
 * while — and those are miserable to set up against a live Mongo.
 *
 * Two rules keep this from doing damage:
 *
 *   - Only providers that actually answered get a vote. Refresh writes to the
 *     catalog now, so treating "the OpenAI call timed out" as "OpenAI serves
 *     nothing" would retire the whole provider on a blip.
 *   - A re-listed model is un-deprecated, so a bad refresh is self-healing on
 *     the next one. `RETIRED_MODEL_IDS` is exempt: those are retired by our
 *     own decision, not the provider's, and boot re-applies them anyway —
 *     without the exemption, refresh and startup would flip the row forever.
 */
export function planDeprecations(input: {
  rows: DeprecationCandidate[];
  seenModelIds: Iterable<string>;
  respondedProviders: Iterable<ModelProvider>;
}): DeprecationPlan {
  const seen = new Set(input.seenModelIds);
  const responded = new Set(input.respondedProviders);
  const retiredByUs = new Set<string>(RETIRED_MODEL_IDS);

  const deprecate: string[] = [];
  const restore: string[] = [];
  const stale: string[] = [];

  for (const row of input.rows) {
    if (!responded.has(row.provider)) continue;

    if (!seen.has(row.modelId)) {
      // Stamp the date only once, so it reads as "first refresh that missed
      // it" rather than "the last time anyone pressed the button".
      if (!row.deprecatedAt) deprecate.push(row.modelId);
      if (row.enabled) stale.push(row.modelId);
      continue;
    }

    if (row.deprecatedAt && !retiredByUs.has(row.modelId)) {
      restore.push(row.modelId);
    }
  }

  return { deprecate, restore, stale };
}
