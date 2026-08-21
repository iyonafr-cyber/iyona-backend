/**
 * One-time welcome credits for new accounts (see `CreditsService.grantSignupWelcomeBonus`).
 * `SIGNUP_BONUS_CREDITS`: unset defaults to 100; explicit 0 disables; positive integers only.
 */
export function signupWelcomeReferenceId(userId: string): string {
  return `signup:welcome:${userId}`;
}

export function parseSignupBonusCreditsEnv(
  env?: Partial<Pick<NodeJS.ProcessEnv, 'SIGNUP_BONUS_CREDITS'>>,
): number {
  const raw = (env ?? process.env).SIGNUP_BONUS_CREDITS;
  if (raw === undefined || raw === '') return 100;
  const trimmed = String(raw).trim();
  if (trimmed === '') return 100;
  const n = Math.trunc(Number(trimmed));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}
