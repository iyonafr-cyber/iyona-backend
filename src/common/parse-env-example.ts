import { isDeployableEnvKey } from './deployable-env-key';

export const MAX_ENV_EXAMPLE_KEYS = 50;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ParseEnvExampleResult {
  /** Declared keys in file order, deduped, capped at {@link MAX_ENV_EXAMPLE_KEYS}. */
  keys: string[];
  /** True when the file contained more than {@link MAX_ENV_EXAMPLE_KEYS} distinct valid keys. */
  tooManyKeys: boolean;
}

/**
 * Parse `.env.example` body: lines are `KEY`, `KEY=`, or `KEY=value` (value ignored).
 */
export function parseEnvExampleKeys(content: string): ParseEnvExampleResult {
  const keys: string[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.replace(/^\s*export\s+/i, '').trim();
    const eq = body.indexOf('=');
    const key = (eq === -1 ? body : body.slice(0, eq)).trim();
    if (!KEY_RE.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  const tooManyKeys = keys.length > MAX_ENV_EXAMPLE_KEYS;
  return {
    keys: tooManyKeys ? keys.slice(0, MAX_ENV_EXAMPLE_KEYS) : keys,
    tooManyKeys,
  };
}

/** Read `.env.example` content from a flat GitHub tree map (path variants). */
export function findEnvExampleContent(
  files: Record<string, string>,
): string | undefined {
  const norm = (p: string) => p.replace(/^\/+/, '');
  for (const [path, content] of Object.entries(files)) {
    const base = norm(path);
    if (base === '.env.example' || base.endsWith('/.env.example')) {
      return content;
    }
  }
  return undefined;
}

/** Build deployable / isSet maps for API responses (no secret material). */
export function buildSecretsManifestFields(keys: string[]): {
  deployable: Record<string, boolean>;
} {
  const deployable: Record<string, boolean> = {};
  for (const k of keys) {
    deployable[k] = isDeployableEnvKey(k);
  }
  return { deployable };
}
