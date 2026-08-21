import {
  isSupabaseProvisioning,
  isSupabaseReadyForUse,
} from './supabase-readiness';

describe('isSupabaseReadyForUse', () => {
  it('returns true when status is ready and credentials exist', () => {
    expect(
      isSupabaseReadyForUse({
        status: 'ready',
        url: 'https://abc.supabase.co',
        anonKeyEnc: 'enc-anon',
        serviceRoleKeyEnc: 'enc-service',
        projectRef: 'abc',
      }),
    ).toBe(true);
  });

  it('accepts legacy plaintext anonKey', () => {
    expect(
      isSupabaseReadyForUse({
        status: 'ready',
        url: 'https://abc.supabase.co',
        anonKey: 'plain-anon',
        serviceRoleKeyEnc: 'enc-service',
      }),
    ).toBe(true);
  });

  it('returns false for ready status without secrets', () => {
    expect(
      isSupabaseReadyForUse({
        status: 'ready',
        url: 'https://abc.supabase.co',
      }),
    ).toBe(false);
  });

  it('returns false while provisioning even if url is set', () => {
    expect(
      isSupabaseReadyForUse({
        status: 'provisioning',
        url: 'https://abc.supabase.co',
        anonKeyEnc: 'enc-anon',
        serviceRoleKeyEnc: 'enc-service',
      }),
    ).toBe(false);
  });

  it('returns false for failed/none', () => {
    expect(isSupabaseReadyForUse({ status: 'failed' })).toBe(false);
    expect(isSupabaseReadyForUse(undefined)).toBe(false);
  });
});

describe('isSupabaseProvisioning', () => {
  it('detects in-flight provisioning', () => {
    expect(isSupabaseProvisioning({ status: 'pending' })).toBe(true);
    expect(isSupabaseProvisioning({ status: 'provisioning' })).toBe(true);
    expect(isSupabaseProvisioning({ status: 'ready' })).toBe(false);
  });
});
