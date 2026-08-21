#!/usr/bin/env node
/**
 * Supabase "builder" smoke script — SHORT PATH, NO MIGRATION LEDGER.
 *
 * Reproduces, end to end, exactly what the Jarvis backend does when a user
 * builds a site "with database" (see src/supabase/supabase.service.ts), but
 * standalone and without the `__jarvis_migrations` ledger:
 *
 *   1. Create a Supabase project        POST /v1/projects
 *   2. Poll for anon + service_role keys GET  /v1/projects/{ref}/api-keys
 *   3. Create a table (raw SQL, RLS on)  POST /v1/projects/{ref}/database/query
 *   4. WRITE a row                       (same SQL endpoint)
 *   5. READ it back                      (same SQL endpoint)
 *   6. Clean up (delete project)         DELETE /v1/projects/{ref}   [unless KEEP_PROJECT=1]
 *
 * Requires (Management API credentials — these are what provisioning needs):
 *   SUPABASE_MGMT_TOKEN   personal access token from https://supabase.com/dashboard/account/tokens
 *   SUPABASE_ORG_ID       target organization id
 * Optional:
 *   SUPABASE_DEFAULT_REGION   (default: us-east-1)
 *   SUPABASE_PLAN             (default: free)
 *   SUPABASE_PROJECT_NAME     (default: jarvis-smoke-<timestamp>)
 *   KEEP_PROJECT=1            keep the created project instead of deleting it
 *
 * Run:  node scripts/supabase-builder-smoke.mjs
 *
 * NOTE: this CREATES A REAL (billable on paid plans) Supabase project.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API = 'https://api.supabase.com';
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal .env loader (process.env wins) ──────────────────────────────────
function loadEnv() {
  const out = { ...process.env };
  try {
    const raw = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (out[k] != null) continue; // real env overrides file
      out[k] = vRaw.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — rely on process.env */
  }
  return out;
}

const env = loadEnv();
const TOKEN = env.SUPABASE_MGMT_TOKEN;
const ORG_ID = env.SUPABASE_ORG_ID;
const REGION = env.SUPABASE_DEFAULT_REGION || 'us-east-1';
const PLAN = env.SUPABASE_PLAN || 'free';
const NAME = env.SUPABASE_PROJECT_NAME || `jarvis-smoke-${Date.now()}`;
const KEEP = env.KEEP_PROJECT === '1';

const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function preflight() {
  const missing = [];
  if (!TOKEN) missing.push('SUPABASE_MGMT_TOKEN');
  if (!ORG_ID) missing.push('SUPABASE_ORG_ID');
  if (missing.length) {
    console.error(
      `\n✗ Cannot run — missing ${missing.join(', ')}.\n\n` +
        `  These are the Management-API credentials the provisioning service\n` +
        `  (src/supabase/supabase.service.ts) requires. The SUPABASE_URL /\n` +
        `  SUPABASE_ANON_KEY currently in .env are a single project's CLIENT\n` +
        `  keys and CANNOT create projects or tables.\n\n` +
        `  Add to .env:\n` +
        `    SUPABASE_MGMT_TOKEN=sbp_...   (account → access tokens)\n` +
        `    SUPABASE_ORG_ID=...           (org settings)\n`,
    );
    process.exit(1);
  }
}

async function mgmt(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** Run raw SQL via the Management API query endpoint (same as SupabaseService.runSql). */
async function runSql(ref, sql) {
  const data = await mgmt('POST', `/v1/projects/${ref}/database/query`, {
    query: sql,
  });
  return Array.isArray(data) ? data : [];
}

async function pollForKeys(ref, deadlineMs = 3 * 60_000) {
  const deadline = Date.now() + deadlineMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const keys = await mgmt('GET', `/v1/projects/${ref}/api-keys`);
      if (
        Array.isArray(keys) &&
        keys.some((k) => k.name === 'anon') &&
        keys.some((k) => k.name === 'service_role')
      ) {
        return keys;
      }
    } catch {
      /* not ready yet */
    }
    const wait = Math.min(2000 * 2 ** Math.min(attempt - 1, 3), 15_000);
    log(`waiting for project to become ready… (attempt ${attempt})`);
    await sleep(wait + Math.floor(Math.random() * 500));
  }
  throw new Error(`Project ${ref} did not become ready within the deadline`);
}

async function main() {
  preflight();

  // ── 1. CREATE PROJECT ────────────────────────────────────────────────────
  log(`Creating project "${NAME}" in org ${ORG_ID} (${REGION}, ${PLAN})…`);
  // db_pass: strong throwaway password — Supabase requires one; rotate later.
  const dbPass =
    'Aa1!' + Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString('base64url');
  const created = await mgmt('POST', '/v1/projects', {
    organization_id: ORG_ID,
    name: NAME,
    region: REGION,
    plan: PLAN,
    db_pass: dbPass,
  });
  const ref = created?.id;
  if (!ref) throw new Error('create response missing `id`');
  log(`✓ project ref: ${ref}  (url: https://${ref}.supabase.co)`);

  let deleted = false;
  try {
    // ── 2. POLL FOR KEYS ────────────────────────────────────────────────────
    const keys = await pollForKeys(ref);
    const anon = keys.find((k) => k.name === 'anon')?.api_key;
    const service = keys.find((k) => k.name === 'service_role')?.api_key;
    log(`✓ keys ready  anon=${anon ? 'yes' : 'NO'}  service_role=${service ? 'yes' : 'NO'}`);

    // ── 3. CREATE TABLE (no ledger; RLS on + permissive policy) ──────────────
    log('Creating table public.jarvis_smoke (RLS enabled)…');
    await runSql(
      ref,
      `create table if not exists public.jarvis_smoke (
         id uuid primary key default gen_random_uuid(),
         label text not null,
         created_at timestamptz not null default now()
       );
       alter table public.jarvis_smoke enable row level security;
       drop policy if exists jarvis_smoke_all on public.jarvis_smoke;
       create policy jarvis_smoke_all on public.jarvis_smoke
         for all using (true) with check (true);`,
    );
    log('✓ table + RLS policy created');

    // ── 4. WRITE ─────────────────────────────────────────────────────────────
    const inserted = await runSql(
      ref,
      `insert into public.jarvis_smoke (label)
       values ('hello from the jarvis builder')
       returning id, label, created_at;`,
    );
    log('✓ wrote row:', JSON.stringify(inserted[0] ?? inserted));

    // ── 5. READ ──────────────────────────────────────────────────────────────
    const rows = await runSql(
      ref,
      `select id, label, created_at
         from public.jarvis_smoke
        order by created_at desc
        limit 5;`,
    );
    log(`✓ read back ${rows.length} row(s):`);
    for (const r of rows) console.log('    ', r.label, '—', r.id);

    console.log('\n✅ Builder round-trip OK: create → keys → table → write → read.');
  } finally {
    // ── 6. CLEANUP ────────────────────────────────────────────────────────────
    if (KEEP) {
      log(`KEEP_PROJECT=1 — leaving project ${ref} in place.`);
    } else {
      log(`Cleaning up — deleting project ${ref}…`);
      await mgmt('DELETE', `/v1/projects/${ref}`).then(
        () => {
          deleted = true;
          log('✓ project deleted');
        },
        (e) => log(`⚠ delete failed (delete it manually): ${e.message}`),
      );
    }
    if (!KEEP && !deleted) {
      console.error(`\n⚠ Project ${ref} may still exist — verify in the dashboard.`);
    }
  }
}

main().catch((err) => {
  console.error('\n✗ FAILED:', err.message);
  process.exit(1);
});
