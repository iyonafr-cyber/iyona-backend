import {
  ensureHttpsDeploymentUrl,
  stripVercelProtectionBypass,
  withVercelProtectionBypass,
  jarvisVercelProjectHostname,
  jarvisVercelPublicPreviewUrl,
} from './vercel-deployment-url.util';

describe('ensureHttpsDeploymentUrl', () => {
  it('builds stable Jarvis project preview hostname', () => {
    expect(jarvisVercelProjectHostname('69fe4e6c1d2c97e96585ba01')).toBe(
      'jarvis-69fe4e6c1d2c97e96585ba01.vercel.app',
    );
    expect(jarvisVercelPublicPreviewUrl('69fe4e6c1d2c97e96585ba01')).toBe(
      'https://jarvis-69fe4e6c1d2c97e96585ba01.vercel.app/',
    );
  });

  it('prefixes https for bare unique deployment hostnames', () => {
    expect(
      ensureHttpsDeploymentUrl(
        'jarvis-69fe4e6c1d2c97e96585ba01-7zeorot1w.vercel.app',
      ),
    ).toBe('https://jarvis-69fe4e6c1d2c97e96585ba01-7zeorot1w.vercel.app/');
  });

  it('canonicalizes existing https origins with trailing slash', () => {
    expect(ensureHttpsDeploymentUrl('https://example.com')).toBe(
      'https://example.com/',
    );
  });

  it('preserves path and query', () => {
    expect(ensureHttpsDeploymentUrl('preview-abc.vercel.app/foo?bar=1')).toBe(
      'https://preview-abc.vercel.app/foo?bar=1',
    );
  });
});

describe('stripVercelProtectionBypass', () => {
  const originalBypass = process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;

  afterEach(() => {
    if (originalBypass === undefined) {
      delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    } else {
      process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS = originalBypass;
    }
  });

  it('upgrades bare hostname before stripping', () => {
    delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    expect(stripVercelProtectionBypass('host.vercel.app')).toBe(
      'https://host.vercel.app/',
    );
  });
});

describe('withVercelProtectionBypass', () => {
  const originalBypass = process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;

  afterEach(() => {
    if (originalBypass === undefined) {
      delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    } else {
      process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS = originalBypass;
    }
  });

  it('returns canonical https URL when bypass is unset', () => {
    delete process.env.VERCEL_DEPLOYMENT_PROTECTION_BYPASS;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    expect(withVercelProtectionBypass('bare.vercel.app')).toBe(
      'https://bare.vercel.app/',
    );
  });
});
