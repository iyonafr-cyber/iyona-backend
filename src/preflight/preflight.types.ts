/**
 * Shared shape for build preflight results.
 *
 * A first build touches four upstreams in sequence — LLM brain → GitHub seed
 * → Cursor agent → Vercel deploy — and each one can be individually fine while
 * another is quota-limited. Failing at step 3 after the user has already
 * answered a questionnaire is the worst outcome: credits are spent, a repo
 * exists, and the chat is stuck mid-flow. So we probe everything up front and
 * refuse to start rather than start and break.
 */

export type PreflightStatus = 'ok' | 'degraded' | 'down';

export type PreflightReason =
  | 'missing_config'
  | 'unauthorized'
  | 'quota_exhausted'
  | 'budget_exhausted'
  | 'unreachable'
  | 'insufficient_credits';

export interface PreflightCheck {
  /** Stable id the frontend switches on: cursor | llm | github | vercel | credits */
  id: string;
  /** Human-facing name for the blocking dialog. */
  label: string;
  status: PreflightStatus;
  /**
   * Whether a `down` status stops the build. `degraded` never blocks — it is
   * "this worked, but you are close to a limit".
   */
  blocking: boolean;
  reason?: PreflightReason;
  /** Operator-facing detail; safe to log, not meant for end users verbatim. */
  detail?: string;
}

export interface PreflightResult {
  /** False when any blocking check is `down`. The gate the client honours. */
  ready: boolean;
  checks: PreflightCheck[];
  /** ISO timestamp of when the upstream probes actually ran (may be cached). */
  checkedAt: string;
}
