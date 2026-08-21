import {
  isByoSupabase,
  isSupabaseReadyForUse,
  resolveSupabaseMigrationMode,
  type SupabaseReadinessSnapshot,
} from './supabase-readiness';
import { resolveSqlTarget } from './supabase-sql-target';
import { isDeployableEnvKey } from '../common/deployable-env-key';
import {
  parseSupabaseConnectionString,
  explainConnectionError,
  InvalidConnectionStringError,
} from '../supabase/supabase-connection-string';
import { isManagedProvisioningEnabled } from '../supabase/managed-provisioning.flag';

const managed = (
  over: Partial<SupabaseReadinessSnapshot> = {},
): SupabaseReadinessSnapshot => ({
  status: 'ready',
  url: 'https://abcdefghijklmnop.supabase.co',
  projectRef: 'abcdefghijklmnop',
  anonKeyEnc: 'enc:anon',
  serviceRoleKeyEnc: 'enc:service',
  ...over,
});

const byo = (
  over: Partial<SupabaseReadinessSnapshot> = {},
): SupabaseReadinessSnapshot => ({
  status: 'ready',
  url: 'https://abcdefghijklmnop.supabase.co',
  projectRef: 'abcdefghijklmnop',
  anonKeyEnc: 'enc:anon',
  source: 'byo',
  ...over,
});

describe('BYO Supabase readiness (decision 07)', () => {
  it('treats a BYO project as ready without a service role key', () => {
    expect(isSupabaseReadyForUse(byo())).toBe(true);
    expect(isByoSupabase(byo())).toBe(true);
  });

  it('still requires a service role key for MANAGED projects', () => {
    // Managed rows without one are incomplete provisioning runs, not a
    // deliberate choice — the old invariant has to survive.
    expect(
      isSupabaseReadyForUse(managed({ serviceRoleKeyEnc: undefined })),
    ).toBe(false);
    expect(isSupabaseReadyForUse(managed())).toBe(true);
  });

  it('treats a row with no source as managed (backwards compatibility)', () => {
    const legacy = managed({ source: undefined });
    expect(isByoSupabase(legacy)).toBe(false);
    expect(resolveSupabaseMigrationMode(legacy)).toBe('mgmt');
  });

  it('needs url and anon key regardless of source', () => {
    expect(isSupabaseReadyForUse(byo({ url: '   ' }))).toBe(false);
    expect(
      isSupabaseReadyForUse(byo({ anonKeyEnc: undefined, anonKey: undefined })),
    ).toBe(false);
    // Legacy plaintext anon key is still honoured.
    expect(
      isSupabaseReadyForUse(byo({ anonKeyEnc: undefined, anonKey: 'plain' })),
    ).toBe(true);
  });

  it('is never ready when status is not "ready"', () => {
    expect(isSupabaseReadyForUse(byo({ status: 'failed' }))).toBe(false);
    expect(isSupabaseReadyForUse(null)).toBe(false);
  });
});

describe('migration mode resolution', () => {
  it('uses direct Postgres when the owner supplied a connection string', () => {
    expect(resolveSupabaseMigrationMode(byo({ dbUrlEnc: 'enc:db' }))).toBe(
      'postgres',
    );
  });

  it('falls back to manual for BYO without a connection string', () => {
    expect(resolveSupabaseMigrationMode(byo())).toBe('manual');
  });

  it('prefers the owner connection string over the Management API', () => {
    // A managed project that has been handed a DB URL should use it: it is the
    // owner's explicit instruction and does not consume platform org quota.
    expect(resolveSupabaseMigrationMode(managed({ dbUrlEnc: 'enc:db' }))).toBe(
      'postgres',
    );
  });

  it('reports "none" when there is no usable database', () => {
    expect(resolveSupabaseMigrationMode(byo({ status: 'none' }))).toBe('none');
    expect(resolveSupabaseMigrationMode(undefined)).toBe('none');
  });
});

describe('resolveSqlTarget', () => {
  const decrypt = (c: string) => c.replace(/^enc:/, '');

  it('produces a postgres target from the encrypted connection string', () => {
    const r = resolveSqlTarget(byo({ dbUrlEnc: 'enc:postgres://x' }), decrypt);
    expect(r.mode).toBe('postgres');
    expect(r.target).toEqual({
      mode: 'postgres',
      connectionString: 'postgres://x',
    });
  });

  it('produces a mgmt target for managed projects', () => {
    const r = resolveSqlTarget(managed(), decrypt);
    expect(r.target).toEqual({ mode: 'mgmt', projectRef: 'abcdefghijklmnop' });
  });

  it('degrades to manual — not a throw — when decryption fails', () => {
    // A deploy must still ship the app when a stored credential is unreadable.
    const r = resolveSqlTarget(byo({ dbUrlEnc: 'enc:x' }), () => {
      throw new Error('bad key');
    });
    expect(r.mode).toBe('manual');
    expect(r.target).toBeUndefined();
    expect(r.error).toMatch(/could not be read/i);
  });

  it('degrades to manual when the decrypted string is empty', () => {
    const r = resolveSqlTarget(byo({ dbUrlEnc: 'enc:' }), decrypt);
    expect(r.mode).toBe('manual');
  });
});

describe('connection string parsing', () => {
  const pooler =
    'postgresql://postgres.abcdefghijklmnop:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

  it('accepts the session pooler string and extracts the project ref', () => {
    const p = parseSupabaseConnectionString(pooler);
    expect(p.kind).toBe('pooler-session');
    expect(p.projectRef).toBe('abcdefghijklmnop');
    expect(p.port).toBe(5432);
    expect(p.warnings).toHaveLength(0);
  });

  it('warns that the direct string is IPv6-only', () => {
    const p = parseSupabaseConnectionString(
      'postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres',
    );
    expect(p.kind).toBe('direct');
    expect(p.warnings.join(' ')).toMatch(/IPv6/i);
  });

  it('warns that the transaction pooler is the wrong choice', () => {
    const p = parseSupabaseConnectionString(pooler.replace(':5432', ':6543'));
    expect(p.kind).toBe('pooler-transaction');
    expect(p.warnings.join(' ')).toMatch(/session pooler/i);
  });

  it('rejects a missing password rather than failing at migration time', () => {
    expect(() =>
      parseSupabaseConnectionString(
        'postgresql://postgres@db.abcdefghijklmnop.supabase.co:5432/postgres',
      ),
    ).toThrow(InvalidConnectionStringError);
  });

  it('rejects non-postgres schemes', () => {
    expect(() =>
      parseSupabaseConnectionString('https://abcdefghijklmnop.supabase.co'),
    ).toThrow(/must start with postgresql/i);
  });

  it('explains an IPv6 failure on the direct host in actionable terms', () => {
    const parsed = parseSupabaseConnectionString(
      'postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres',
    );
    const msg = explainConnectionError({ code: 'ENOTFOUND' }, parsed);
    expect(msg).toMatch(/Session pooler/i);
  });

  it('explains a bad password without echoing the credential', () => {
    const msg = explainConnectionError({ code: '28P01' }, null);
    expect(msg).toMatch(/rejected the password/i);
  });
});

describe('deployable env keys — server-only credentials', () => {
  it('blocks the database URL that SUPABASE_ prefix would otherwise allow', () => {
    // The regression this guards: SUPABASE_ is allowlisted, so without an
    // exact-match block a pasted DB password lands in the Vercel build env.
    expect(isDeployableEnvKey('SUPABASE_DB_URL')).toBe(false);
    expect(isDeployableEnvKey('supabase_db_url')).toBe(false);
    expect(isDeployableEnvKey('SUPABASE_SERVICE_ROLE_KEY')).toBe(false);
    expect(isDeployableEnvKey('SUPABASE_DB_PASSWORD')).toBe(false);
  });

  it('still allows the client keys the generated app needs', () => {
    expect(isDeployableEnvKey('VITE_SUPABASE_URL')).toBe(true);
    expect(isDeployableEnvKey('VITE_SUPABASE_ANON_KEY')).toBe(true);
    expect(isDeployableEnvKey('SUPABASE_URL')).toBe(true);
  });

  it('blocks on exact match only, not prefix', () => {
    expect(isDeployableEnvKey('SUPABASE_DB_URL_LABEL')).toBe(true);
  });
});

describe('managed provisioning flag', () => {
  const original = process.env.SUPABASE_MANAGED_PROVISIONING;
  afterEach(() => {
    process.env.SUPABASE_MANAGED_PROVISIONING = original;
  });

  it('is off when unset — the default posture after decision 07', () => {
    delete process.env.SUPABASE_MANAGED_PROVISIONING;
    expect(isManagedProvisioningEnabled()).toBe(false);
  });

  it('is off for anything that is not an explicit opt-in', () => {
    for (const v of ['', 'false', '0', 'no', 'off', 'maybe']) {
      process.env.SUPABASE_MANAGED_PROVISIONING = v;
      expect(isManagedProvisioningEnabled()).toBe(false);
    }
  });

  it('turns on for explicit truthy values', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
      process.env.SUPABASE_MANAGED_PROVISIONING = v;
      expect(isManagedProvisioningEnabled()).toBe(true);
    }
  });
});

describe('status field consistency', () => {
  /**
   * `autoMigrations` and `migrationMode` are two views of one decision and are
   * rendered side by side in the settings panel. They once disagreed: a
   * managed row with a project ref but no service-role key reported
   * `migrationMode: 'none'` (correct — not usable) alongside
   * `autoMigrations: true`, i.e. "we apply your schema automatically" for a
   * database Jarvis could not reach. Derive one from the other, never both
   * from the raw fields.
   */
  const autoFromMode = (m: string) => m === 'postgres' || m === 'mgmt';

  const cases: Array<[string, SupabaseReadinessSnapshot]> = [
    ['byo manual', byo()],
    ['byo with db url', byo({ dbUrlEnc: 'enc:db' })],
    ['legacy managed', managed()],
    ['legacy partial', managed({ serviceRoleKeyEnc: undefined })],
    ['no database', { status: 'none' } as SupabaseReadinessSnapshot],
  ];

  for (const [name, sb] of cases) {
    it(`${name}: autoMigrations agrees with migrationMode`, () => {
      const mode = resolveSupabaseMigrationMode(sb);
      expect(autoFromMode(mode)).toBe(
        mode === 'postgres' || mode === 'mgmt',
      );
      // A project that is not usable must never claim automatic migrations.
      if (!isSupabaseReadyForUse(sb)) {
        expect(autoFromMode(mode)).toBe(false);
      }
    });
  }
});
