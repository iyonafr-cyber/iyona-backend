import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Ensures status polling resolves deployments during repair redeploys.
 */
describe('Deployment progress lookup', () => {
  it('getDeploymentProgress queries by client id or active repair id', () => {
    const src = readFileSync(join(__dirname, 'revisions.service.ts'), 'utf8');
    expect(src).toContain("'metadata.activeVercelDeploymentId'");
    expect(src).toContain("'metadata.clientPollingDeploymentId'");
  });

  it('getCurrentDeploymentProgress resolves latest deployment + polling id', () => {
    const src = readFileSync(join(__dirname, 'revisions.service.ts'), 'utf8');
    expect(src).toContain('async getCurrentDeploymentProgress');
    expect(src).toContain('clientPollingDeploymentId');
    expect(src).toContain('getDeploymentProgress(projectId, pollingId)');
  });
});
