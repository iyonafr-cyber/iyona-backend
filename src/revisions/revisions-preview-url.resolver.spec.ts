import {
  pickFirstPreviewUrlRaw,
  finalizePreviewUrlForApi,
} from './revisions-preview-url.resolver';

describe('pickFirstPreviewUrlRaw', () => {
  it('prefers project root over embedded deployment', () => {
    expect(
      pickFirstPreviewUrlRaw({
        projectPreviewUrl: 'https://root.example',
        embeddedWorkflowPreviewUrl: 'https://embedded.example',
      }),
    ).toBe('https://root.example');
  });

  it('uses embedded deployment when root is empty', () => {
    expect(
      pickFirstPreviewUrlRaw({
        projectPreviewUrl: '',
        embeddedWorkflowPreviewUrl: 'https://embedded.example',
      }),
    ).toBe('https://embedded.example');
  });

  it('uses deployment document preview before revision', () => {
    expect(
      pickFirstPreviewUrlRaw({
        embeddedWorkflowPreviewUrl: undefined,
        deploymentDocumentPreviewUrl: 'https://dep-row.example',
        revisionPreviewUrl: 'https://rev.example',
      }),
    ).toBe('https://dep-row.example');
  });

  it('falls back to deploymentUrl on deployment row when preview missing', () => {
    expect(
      pickFirstPreviewUrlRaw({
        deploymentDocumentDeploymentUrl: 'https://vercel-url.example',
      }),
    ).toBe('https://vercel-url.example');
  });

  it('uses revision when higher layers are absent', () => {
    expect(
      pickFirstPreviewUrlRaw({
        revisionPreviewUrl: 'https://revision.example',
      }),
    ).toBe('https://revision.example');
  });

  it('prefers revision preview over revision deploymentUrl', () => {
    expect(
      pickFirstPreviewUrlRaw({
        revisionPreviewUrl: 'https://preview.example',
        revisionDeploymentUrl: 'https://deploy.example',
      }),
    ).toBe('https://preview.example');
  });

  it('returns null when nothing is set', () => {
    expect(pickFirstPreviewUrlRaw({})).toBeNull();
  });

  it('trims whitespace on winning candidate', () => {
    expect(
      pickFirstPreviewUrlRaw({
        projectPreviewUrl: '  https://trim.example  ',
      }),
    ).toBe('https://trim.example');
  });
});

describe('finalizePreviewUrlForApi', () => {
  const originalBypass = process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;

  afterEach(() => {
    if (originalBypass === undefined) {
      delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    } else {
      process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS = originalBypass;
    }
  });

  it('returns null for null input', () => {
    expect(finalizePreviewUrlForApi(null)).toBeNull();
  });

  it('returns URL unchanged when bypass secret is unset', () => {
    delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    expect(finalizePreviewUrlForApi('https://app.example')).toBe(
      'https://app.example/',
    );
  });

  it('prefixes https for bare hostname when bypass secret is unset', () => {
    delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    expect(
      finalizePreviewUrlForApi(
        'jarvis-69fe4e6c1d2c97e96585ba01-7zeorot1w.vercel.app',
      ),
    ).toBe('https://jarvis-69fe4e6c1d2c97e96585ba01-7zeorot1w.vercel.app/');
  });
});
