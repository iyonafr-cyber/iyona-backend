/**
 * Drift guard. The agent prompts advertise a fixed list of kit components and
 * "NEVER define your own version of these" — so a component added to the kit
 * but missing from the manifest is invisible to the agent, which then hand-rolls
 * a duplicate. That is exactly how the cleanup/chat prompts ended up 18
 * components behind. This test fails the build instead.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  KIT_COMPONENT_NAMES,
  KIT_DEPENDENCIES,
  SCAFFOLD_DEPENDENCIES,
} from './ui-kit.constants';
import {
  KIT_INVENTORY,
  VERSION_PINS_LINE,
  KIT_DEPENDENCIES_LINE,
} from './kit-prompt';

/** Top-level component names exported from the seeded kit barrel file. */
function exportedComponentNames(): string[] {
  const src = readFileSync(
    join(__dirname, 'files/components/ui/index.ts'),
    'utf8',
  );
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s*{([\s\S]*?)}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const entry = raw.trim();
      if (!entry || entry.startsWith('type ')) continue; // type-only export
      const name = entry.split(/\s+as\s+/)[0];
      if (/^[A-Z][A-Za-z]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

describe('UI kit prompt manifest', () => {
  it('advertises every component the seeded kit exports', () => {
    const advertised = new Set<string>(KIT_COMPONENT_NAMES);
    // Sub-components travel with their parent (Card → CardHeader, Tabs → TabsList).
    const parents = [...advertised];
    const missing = exportedComponentNames().filter(
      (n) =>
        !advertised.has(n) &&
        !parents.some((p) => n.startsWith(p) && n !== p) &&
        n !== 'ToastContainer',
    );
    expect(missing).toEqual([]);
  });

  it('renders every advertised component into the prompt inventory', () => {
    const missing = KIT_COMPONENT_NAMES.filter(
      (n) => !KIT_INVENTORY.includes(n === 'Toast' ? 'toast' : n),
    );
    expect(missing).toEqual([]);
  });

  it('renders every pinned version into the prompt lines', () => {
    for (const [name, range] of Object.entries(SCAFFOLD_DEPENDENCIES)) {
      expect(VERSION_PINS_LINE).toContain(`"${name}": "${range}"`);
    }
    for (const [name, range] of Object.entries(KIT_DEPENDENCIES)) {
      expect(KIT_DEPENDENCIES_LINE).toContain(`"${name}": "${range}"`);
    }
  });
});
