import { isDeployableEnvKey } from './deployable-env-key';

describe('isDeployableEnvKey', () => {
  it('allows VITE and NEXT_PUBLIC', () => {
    expect(isDeployableEnvKey('VITE_FOO')).toBe(true);
    expect(isDeployableEnvKey('NEXT_PUBLIC_BAR')).toBe(true);
  });

  it('blocks NODE_ and PATH-like', () => {
    expect(isDeployableEnvKey('NODE_OPTIONS')).toBe(false);
    expect(isDeployableEnvKey('PATH')).toBe(false);
  });

  it('rejects unknown prefixes', () => {
    expect(isDeployableEnvKey('SECRET_KEY')).toBe(false);
  });
});
