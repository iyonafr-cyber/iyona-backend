import { readFileSync } from 'fs';
import { join } from 'path';

describe('revisions deploy pipeline wiring (source)', () => {
  const root = join(__dirname);

  function runDeployPipelineBody(src: string): string {
    const start = src.indexOf('private async runDeployPipeline');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  async getDeploymentProgress', start);
    return end > -1 ? src.slice(start, end) : src.slice(start);
  }

  it('deployPreview marks DEPLOYING then defers work to runDeployPipeline', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    const idxDeploying = src.indexOf(
      'revision.status = RevisionStatus.DEPLOYING',
    );
    const idxBg = src.indexOf('void this.runDeployPipeline', idxDeploying);
    expect(idxDeploying).toBeGreaterThan(-1);
    expect(idxBg).toBeGreaterThan(idxDeploying);
  });

  it('runDeployPipeline loads GitHub tree before each Vercel createDeployment', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    const pipeline = runDeployPipelineBody(src);
    const idxRead = pipeline.indexOf('this.repoService.readTreeAtSha');
    const idxCreate = pipeline.indexOf(
      'vercelDeployment = await this.vercelService.createDeployment',
    );
    expect(idxRead).toBeGreaterThan(-1);
    expect(idxCreate).toBeGreaterThan(idxRead);
  });

  it('runDeployPipeline runs Cursor cleanup before the deploy loop', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    const pipeline = runDeployPipelineBody(src);
    const cleanupIdx = pipeline.indexOf("kind: 'cleanup'");
    const loopIdx = pipeline.indexOf(
      'for (let attempt = 1; attempt <= MAX_REPAIR + 1; attempt++)',
    );
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(cleanupIdx);
  });

  it('Vercel build failure path fetches logs before Cursor repair', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    const pipeline = runDeployPipelineBody(src);
    const logsIdx = pipeline.indexOf(
      'const buildLogs = await this.vercelService',
    );
    const repairIdx = pipeline.indexOf("kind: 'repair'", logsIdx);
    expect(logsIdx).toBeGreaterThan(-1);
    expect(repairIdx).toBeGreaterThan(logsIdx);
  });

  it('Cursor repair round receives the Vercel log tail', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    expect(src).toContain('vercelBuildLogTail: buildLogs');
  });

  it('classifyBuildFailure consults parseBuildErrors for TypeScript signals', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    const classifyStart = src.indexOf('private classifyBuildFailure');
    expect(classifyStart).toBeGreaterThan(-1);
    const classifySnippet = src.slice(classifyStart, classifyStart + 2500);
    expect(classifySnippet).toContain('parseBuildErrors');
  });

  it('runDeployPipeline supports skipCursorCleanup for post-agent deploys', () => {
    const src = readFileSync(join(root, 'revisions.service.ts'), 'utf8');
    expect(src).toContain('skipCursorCleanup');
    expect(src).toContain('shouldSkipCleanup');
    expect(src).toContain('completenessHint');
  });
});
