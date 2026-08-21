/**
 * Canonical action catalogue for the credit system.
 *
 * Every AI endpoint is tagged with one of these keys via `@CreditAction(key)`.
 * `minReserve` is the floor we pre-deduct to guarantee a user can't start an
 * action they can't afford. The real charge happens after the provider call
 * based on actual token usage, and any unused portion of the reserve is
 * refunded atomically — so this number is intentionally a conservative
 * upper bound.
 *
 * `displayCredits` is the value we surface to the UI. It's an *approximation*
 * aligned with the research doc's "action based pricing" UX (section 3.3).
 */

export type CreditActionKey =
  | 'validate'
  | 'questionnaire'
  | 'execution_plan'
  | 'build_spec'
  | 'patch_apply'
  | 'schema_extract'
  | 'chat_prompt'
  | 'cursor_agent_update'
  | 'cursor_agent_question'
  | 'workspace_deploy';

export interface CreditActionConfig {
  key: CreditActionKey;
  /** Minimum credits that must be available before we even call the LLM. */
  minReserve: number;
  /** UX-facing approximate cost, never the actual deducted value. */
  displayCredits: number;
  /** Task label forwarded to ModelRouter for provider/model selection. */
  routerTask: 'classify' | 'plan' | 'reason' | 'extract';
}

export const CREDIT_ACTIONS: Record<CreditActionKey, CreditActionConfig> = {
  validate: {
    key: 'validate',
    minReserve: 2,
    displayCredits: 2,
    routerTask: 'classify',
  },
  questionnaire: {
    key: 'questionnaire',
    minReserve: 2,
    displayCredits: 3,
    routerTask: 'classify',
  },
  execution_plan: {
    key: 'execution_plan',
    minReserve: 5,
    displayCredits: 5,
    routerTask: 'plan',
  },
  // Spec→Cursor path: the LLM "brain" writes a rich build brief
  // (design tokens, page layouts, animations, shared shell) instead of full
  // code. Output is a few thousand tokens, so the floor stays low — the
  // expensive code authorship is offloaded to the Cursor agent worker.
  build_spec: {
    key: 'build_spec',
    minReserve: 6,
    displayCredits: 6,
    routerTask: 'plan',
  },
  patch_apply: {
    key: 'patch_apply',
    minReserve: 8,
    displayCredits: 8,
    routerTask: 'reason',
  },
  schema_extract: {
    key: 'schema_extract',
    minReserve: 3,
    displayCredits: 3,
    routerTask: 'extract',
  },
  chat_prompt: {
    key: 'chat_prompt',
    minReserve: 2,
    displayCredits: 3,
    routerTask: 'classify',
  },
  cursor_agent_update: {
    key: 'cursor_agent_update',
    minReserve: 8,
    displayCredits: 10,
    routerTask: 'reason',
  },
  // Read-only codebase Q&A: one short agent run, no build and no deploy, so it
  // is far cheaper than an update round.
  cursor_agent_question: {
    key: 'cursor_agent_question',
    minReserve: 2,
    displayCredits: 3,
    routerTask: 'reason',
  },
  // Redeploy of the current GitHub HEAD. Runs a Cursor cleanup round plus up
  // to N repair rounds against Vercel build failures — each an agent run — so
  // it must be metered like an update. Without this the deploy endpoint let a
  // user launch unlimited free agent rounds by repeatedly redeploying.
  workspace_deploy: {
    key: 'workspace_deploy',
    minReserve: 8,
    displayCredits: 10,
    routerTask: 'reason',
  },
};

export function getCreditAction(key: CreditActionKey): CreditActionConfig {
  return CREDIT_ACTIONS[key];
}
