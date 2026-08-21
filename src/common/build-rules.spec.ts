/**
 * Drift guard for the shared build rules. Each rule is restated at several
 * stages on purpose; this asserts the restatements still come from the single
 * definition, so tightening a rule reaches every stage that enforces it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ENTITY_PARITY_FOR_PLAN,
  ENTITY_PARITY_FOR_WORKER,
  ENTITY_PARITY_FOR_FIX,
  DB_SYNC_FOR_PLAN,
  DB_SYNC_FOR_WORKER,
  DB_SYNC_FOR_FIX,
  ADMIN_FOR_PLAN,
  ADMIN_FOR_WORKER,
} from './build-rules';

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8');

describe('shared build rules', () => {
  it('states the parity requirement in every audience variant', () => {
    for (const variant of [
      ENTITY_PARITY_FOR_PLAN,
      ENTITY_PARITY_FOR_WORKER,
      ENTITY_PARITY_FOR_FIX,
    ]) {
      expect(variant).toMatch(
        /create (form )?AND the edit form|create and edit forms/,
      );
      expect(variant).toMatch(/marked `user`|user-supplied field/);
    }
  });

  it('carries the same concrete failure example into plan, worker and fix rounds', () => {
    const example = 'name, year and price';
    expect(ENTITY_PARITY_FOR_PLAN).toContain(example);
    expect(ENTITY_PARITY_FOR_WORKER).toContain(example);
    expect(ENTITY_PARITY_FOR_FIX).toContain(example);
  });

  it('names the split-brain symptom in every db-sync variant', () => {
    for (const variant of [
      DB_SYNC_FOR_PLAN,
      DB_SYNC_FOR_WORKER,
      DB_SYNC_FOR_FIX,
    ]) {
      expect(variant).toMatch(/static array/);
    }
    expect(DB_SYNC_FOR_WORKER).toContain('__schema__.json');
    expect(DB_SYNC_FOR_PLAN).toContain('__schema__.json');
  });

  it('keeps the admin surface separate in both variants', () => {
    for (const variant of [ADMIN_FOR_PLAN, ADMIN_FOR_WORKER]) {
      expect(variant).toContain('AdminLayout');
      expect(variant).toContain('/admin/settings');
      expect(variant).toMatch(/never wraps|never mix|NEVER the public Header/);
    }
  });

  it('leaves no hand-written copy of these rules in the prompt sources', () => {
    const sources = [
      read('ai/ai.service.ts'),
      read('cursor/cursor.service.ts'),
      read('common/content-completeness.ts'),
    ].join('\n');
    // Headings that used to be typed out per prompt. They may now appear only
    // via build-rules.ts, which this spec imports rather than greps.
    for (const heading of [
      'ENTITY FIELD CONTRACT',
      'DATABASE SYNC (when the plan wires Supabase',
      'ADMIN PANEL (when the plan has /admin routes',
    ]) {
      expect(sources).not.toContain(heading);
    }
  });
});
