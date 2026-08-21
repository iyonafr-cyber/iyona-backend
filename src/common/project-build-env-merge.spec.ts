import { mergeProjectDeployBuildEnv } from './project-build-env-merge';
import { isDeployableEnvKey } from './deployable-env-key';

describe('mergeProjectDeployBuildEnv', () => {
  it('merges with platform overriding user on duplicate', () => {
    const merged = mergeProjectDeployBuildEnv(
      { VITE_SUPABASE_URL: 'user', VITE_A: '1' },
      { VITE_SUPABASE_URL: 'https://sb', VITE_SUPABASE_ANON_KEY: 'anon' },
      { VITE_ANALYTICS_PROVIDER: 'none' },
    );
    expect(merged?.VITE_SUPABASE_URL).toBe('https://sb');
    expect(merged?.VITE_A).toBe('1');
    expect(merged?.VITE_ANALYTICS_PROVIDER).toBe('none');
  });

  it('returns undefined when all empty', () => {
    expect(mergeProjectDeployBuildEnv(undefined, undefined, undefined)).toBe(
      undefined,
    );
  });

  it('includes the Stripe env map when provided', () => {
    const merged = mergeProjectDeployBuildEnv(undefined, undefined, undefined, {
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
    });
    expect(merged?.VITE_STRIPE_PUBLISHABLE_KEY).toBe('pk_test_123');
  });

  it('is a no-op when the Stripe map is omitted (backward compatible)', () => {
    const merged = mergeProjectDeployBuildEnv(
      { VITE_A: '1' },
      undefined,
      undefined,
    );
    expect(merged).toEqual({ VITE_A: '1' });
    expect(merged?.VITE_STRIPE_PUBLISHABLE_KEY).toBeUndefined();
  });

  it('lets analytics win over Stripe on a duplicate key (merge order)', () => {
    const merged = mergeProjectDeployBuildEnv(
      undefined,
      undefined,
      { VITE_DUP: 'analytics' },
      { VITE_DUP: 'stripe' },
    );
    // Order is user → supabase → stripe → analytics, last wins.
    expect(merged?.VITE_DUP).toBe('analytics');
  });

  it('exposes the Stripe publishable key as a deployable env key', () => {
    // Guards the guidance in the builder prompts: the key the agent is told
    // to read (VITE_STRIPE_PUBLISHABLE_KEY) must actually reach the bundle.
    expect(isDeployableEnvKey('VITE_STRIPE_PUBLISHABLE_KEY')).toBe(true);
  });
});
