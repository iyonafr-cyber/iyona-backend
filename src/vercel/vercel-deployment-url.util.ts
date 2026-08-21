/**
 * Vercel Deployment Protection (password / Vercel Auth / Trusted IPs) serves an
 * interstitial that sets `X-Frame-Options: DENY`, which blocks the Jarvis
 * workspace iframe regardless of CSP `frame-ancestors` on the built app.
 *
 * When "Protection Bypass for Automation" is configured on the Vercel
 * project, requests that include the bypass token skip that interstitial.
 * Iframes cannot send custom headers, so the supported approach is the
 * `x-vercel-protection-bypass` query parameter.
 *
 * @see https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection
 */

const BYPASS_QUERY = 'x-vercel-protection-bypass';

/**
 * Vercel APIs and legacy Mongo rows often store deployment URLs as bare hostnames
 * (`project-xxx.vercel.app`) without `https://`. Clients and `URL()` need an absolute URL.
 */
export function ensureHttpsDeploymentUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return withScheme;
  }
}

/**
 * Stable public hostname on Vercel for Jarvis projects (matches POST /v13/deployments `name`).
 * Each deployment also receives a unique `jarvis-{projectId}-{hash}.vercel.app` URL; use
 * {@link jarvisVercelPublicPreviewUrl} for the shareable project preview, not the deployment URL.
 */
export function jarvisVercelProjectHostname(projectId: string): string {
  return `jarvis-${projectId}.vercel.app`;
}

/** Canonical https URL for the stable project preview on *.vercel.app. */
export function jarvisVercelPublicPreviewUrl(projectId: string): string {
  return ensureHttpsDeploymentUrl(jarvisVercelProjectHostname(projectId));
}

function resolveProtectionBypassSecret(): string | undefined {
  const s =
    process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS?.trim() ||
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return s || undefined;
}

/** Remove bypass query param before persisting URLs or using them as SEO base. */
export function stripVercelProtectionBypass(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(ensureHttpsDeploymentUrl(url));
    if (!u.searchParams.has(BYPASS_QUERY)) return u.href;
    u.searchParams.delete(BYPASS_QUERY);
    const q = u.searchParams.toString();
    u.search = q ? `?${q}` : '';
    return u.toString();
  } catch {
    return ensureHttpsDeploymentUrl(url);
  }
}

/**
 * Append the automation bypass query param when configured. Returns the
 * canonical https URL when no secret is set (or URL is invalid).
 */
export function withVercelProtectionBypass(
  url: string | null | undefined,
): string | null {
  if (url == null || url === '') return url ?? null;
  const normalized = ensureHttpsDeploymentUrl(url);
  const secret = resolveProtectionBypassSecret();
  if (!secret) return normalized;
  try {
    const u = new URL(normalized);
    if (u.searchParams.get(BYPASS_QUERY) === secret) return normalized;
    u.searchParams.set(BYPASS_QUERY, secret);
    return u.toString();
  } catch {
    return normalized;
  }
}
