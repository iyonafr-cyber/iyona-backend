/**
 * Merge Vercel build-time env maps. Later maps override earlier keys.
 * Order: user app secrets → Supabase → Stripe → analytics (platform wins on dupes).
 */
export function mergeProjectDeployBuildEnv(
  userSecrets: Record<string, string> | undefined,
  supabase: Record<string, string> | undefined,
  analytics: Record<string, string> | undefined,
  stripe?: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const out = {
    ...(userSecrets ?? {}),
    ...(supabase ?? {}),
    ...(stripe ?? {}),
    ...(analytics ?? {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}
