import { withVercelProtectionBypass } from '../vercel/vercel-deployment-url.util';

/**
 * Ordered preview URL sources for workspace reload vs polling consistency.
 * Mirrors public/settings merge order, then revisions Deployment row, then
 * latest DEPLOYED revision — see RevisionsService.getPreviewUrl.
 */
export type PreviewUrlLayerInputs = {
  projectPreviewUrl?: string | null;
  embeddedWorkflowPreviewUrl?: string | null;
  deploymentDocumentPreviewUrl?: string | null;
  deploymentDocumentDeploymentUrl?: string | null;
  revisionPreviewUrl?: string | null;
  revisionDeploymentUrl?: string | null;
};

/** First non-empty trimmed URL wins (no bypass — caller applies). */
export function pickFirstPreviewUrlRaw(
  input: PreviewUrlLayerInputs,
): string | null {
  const candidates = [
    input.projectPreviewUrl,
    input.embeddedWorkflowPreviewUrl,
    input.deploymentDocumentPreviewUrl || input.deploymentDocumentDeploymentUrl,
    input.revisionPreviewUrl || input.revisionDeploymentUrl,
  ];
  for (const c of candidates) {
    if (c != null && typeof c === 'string') {
      const t = c.trim();
      if (t) return t;
    }
  }
  return null;
}

export function finalizePreviewUrlForApi(raw: string | null): string | null {
  return withVercelProtectionBypass(raw);
}
