/**
 * Content-completeness gate.
 *
 * Scans a generated file map for stub/placeholder patterns that indicate the
 * model bailed before producing real content. Surfaces a per-file verdict so
 * the orchestrator can either trigger a multi-pass repair or block deploy.
 *
 * This is the gate the system was missing: build-time checks (tsc / vite) pass
 * happily on `<h1>Welcome to Our App</h1>` + `Description of feature one`, so
 * stubs were shipping straight to production.
 */

import { detectArchetype } from './app-archetypes';
import { ENTITY_PARITY_FOR_FIX, DB_SYNC_FOR_FIX } from './build-rules';

const MANDATORY_FILES = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
];

// Substrings (case-insensitive) that are dead giveaways of stub content.
const STUB_TEXT_PATTERNS: RegExp[] = [
  /\bWelcome to Our App\b/i,
  /\bDescription of feature (one|two|three|\d+)\b/i,
  /\bFeature (One|Two|Three)\b/,
  /\bLorem ipsum\b/i,
  /\bGet Started Today\b/i, // generic CTA that ships with stub landings
  /\bExperience the future of technology with us\b/i,
  /\bYour (app|website|product) tagline\b/i,
];

// Comment / pseudo-code patterns the model leaves when it gives up mid-file.
const STUB_COMMENT_PATTERNS: RegExp[] = [
  /\{\s*\/\*[^*]*(?:like|such as|e\.g\.|etc\.?|other|more components?)[^*]*\*\/\s*\}/i,
  /\/\/\s*(TODO|FIXME|XXX|HACK)\b/,
  /\{\s*\/\*\s*(TODO|FIXME|XXX|HACK)\b/i,
  /\/\*\s*(TODO|FIXME|XXX|HACK)\b/,
  /\.\.\.\s*(rest|more|other|etc|and so on)\b/i,
  /\{\s*\/\*\s*\.\.\.\s*\*\/\s*\}/,
];

// File-size floors by extension. Real components / pages are bigger than this;
// anything smaller is almost certainly a stub.
const MIN_BYTES_BY_EXT: Record<string, number> = {
  '.tsx': 400,
  '.ts': 200,
  '.css': 200,
  '.html': 200,
};

export type StubReason =
  | 'missing-mandatory'
  | 'too-small'
  | 'stub-text'
  | 'stub-comment'
  | 'placeholder-only'
  | 'empty'
  | 'redefines-kit-primitive'
  | 'broken-link'
  | 'thin-page'
  | 'dead-control'
  | 'no-persistence'
  | 'entity-field-drift'
  | 'split-data-source'
  | 'admin-shell-leak';

export interface CompletenessIssue {
  path: string;
  reason: StubReason;
  detail: string;
}

export interface CompletenessReport {
  ok: boolean;
  issues: CompletenessIssue[];
  /** File paths that need to be regenerated. Deduplicated. */
  stubPaths: string[];
  /** Files that were missing from the output entirely. */
  missing: string[];
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

function isPlaceholderOnly(content: string): boolean {
  // A page/component whose JSX body is just a few headings + one-line text.
  // Triggers on the canonical "Welcome / Features / 3 cards" stub.
  const trimmed = content.trim();
  if (trimmed.length < 600) return false;
  const headingMatches = trimmed.match(/<h[1-6][^>]*>/gi) ?? [];
  const componentMatches = trimmed.match(/<[A-Z][A-Za-z0-9]+/g) ?? [];
  // Lots of headings but almost no nested components → flat placeholder layout.
  return headingMatches.length >= 3 && componentMatches.length < 4;
}

// Paths managed by the UI kit — skip them in completeness checks since they
// are injected by the backend and known to be correct.
const KIT_PATH_PREFIXES = [
  'src/components/ui/',
  'src/lib/cn.ts',
  'src/styles/ui-kit.css',
];

function isKitPath(path: string): boolean {
  return KIT_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));
}

// ── Structural pass (cross-file) ─────────────────────────────────────────────
// These see structure a lexical scan can't: links pointing at routes that were
// never created, dead nav icons, bare pages, and unpersisted CRUD state. Each
// check is conservative and self-disables when it cannot parse confidently, so
// it never triggers a needless repair round on a legitimately simple app.

const ROUTE_PATH_RE =
  /<Route\b[^>]*\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})|(?:^|[\s{,])path\s*:\s*(?:"([^"]*)"|'([^']*)')/g;

const LINK_TARGET_RE =
  /(?:\b(?:to|href)\s*=\s*|navigate\(\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

function firstSeg(path: string): string {
  const clean = path.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, ':p');
  const segs = clean.split('/').filter(Boolean);
  return segs[0] ?? '';
}

function allSegs(path: string): string[] {
  const clean = path.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, ':p');
  return clean.split('/').filter(Boolean);
}

/** Collect every route path declared anywhere in the tree. */
function collectDefinedRoutes(files: Record<string, string>): {
  firstSegments: Set<string>;
  allSegments: Set<string>;
  count: number;
} {
  const firstSegments = new Set<string>();
  const allSegments = new Set<string>();
  let count = 0;
  for (const content of Object.values(files)) {
    let m: RegExpExecArray | null;
    ROUTE_PATH_RE.lastIndex = 0;
    while ((m = ROUTE_PATH_RE.exec(content)) !== null) {
      const path = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      if (path === undefined) continue;
      count += 1;
      const fs = firstSeg(path);
      if (fs) firstSegments.add(fs.toLowerCase());
      for (const s of allSegs(path)) allSegments.add(s.toLowerCase());
    }
  }
  return { firstSegments, allSegments, count };
}

// ── Entity field contract ────────────────────────────────────────────────────
// The highest-signal "this generated app is broken" failure: an entity whose
// card/detail page renders six fields but whose "Add X" form only collects
// three. We reconstruct each entity's field set from its TypeScript interface,
// then verify the create/edit form for that entity actually has an input for
// every user-supplied field.

/** Fields a form legitimately omits because the app generates them. */
const SYSTEM_FIELD_RE =
  /^(id|_id|uid|uuid|key|slug|createdat|updatedat|created_at|updated_at|created|updated|timestamp|rating|ratings|reviews|reviewcount|review_count|numreviews|views|likes|favorites|comments|sales|popularity|featured|isfeatured|is_featured|isnew|is_new|isactive|is_active|userid|user_id|authorid|author_id|ownerid|owner_id|sellerid|seller_id)$/i;

/** Interface names that describe UI plumbing, not a domain entity. */
const NON_ENTITY_NAME_RE =
  /(props|state|context|config|params|options|response|payload|result|filter|filters|formdata|formvalues|formstate|store|theme|route|routes|action|actions|handler|handlers|error|errors)$/i;

/** `export interface Foo { … }` / `export type Foo = { … }` — flat bodies only. */
const ENTITY_DECL_RE =
  /export\s+(?:interface\s+([A-Z]\w*)\s*\{|type\s+([A-Z]\w*)\s*=\s*\{)([^{}]*)\}/g;

// Delimiter-anchored so it reads both multi-line and single-line bodies.
const ENTITY_FIELD_RE = /(?:^|[;,{])\s*(?:readonly\s+)?(\w+)\s*\??\s*:/g;

interface EntityShape {
  name: string;
  path: string;
  /** Fields a person is expected to supply (system-generated ones excluded). */
  userFields: string[];
}

function collectEntityShapes(files: Record<string, string>): EntityShape[] {
  const shapes: EntityShape[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (isKitPath(path)) continue;
    const ext = extOf(path);
    if (ext !== '.ts' && ext !== '.tsx') continue;

    let m: RegExpExecArray | null;
    ENTITY_DECL_RE.lastIndex = 0;
    while ((m = ENTITY_DECL_RE.exec(content)) !== null) {
      const name = m[1] ?? m[2];
      const body = m[3] ?? '';
      if (!name || NON_ENTITY_NAME_RE.test(name)) continue;

      const fields: string[] = [];
      let f: RegExpExecArray | null;
      ENTITY_FIELD_RE.lastIndex = 0;
      while ((f = ENTITY_FIELD_RE.exec(body)) !== null) fields.push(f[1]);

      // Need a confidently-parsed, entity-sized shape before we judge a form.
      if (fields.length < 4) continue;
      const userFields = fields.filter((x) => !SYSTEM_FIELD_RE.test(x));
      if (userFields.length < 3) continue;

      shapes.push({ name, path, userFields });
    }
  }
  return shapes;
}

/** Field names a form file appears to collect. */
const FORM_FIELD_PATTERNS: RegExp[] = [
  /\b(?:name|id|htmlFor)\s*=\s*["'](\w+)["']/g,
  /\b(?:formData|formValues|form|values|draft|newItem|input|fields)\s*\.\s*(\w+)/g,
  /[{,]\s*(\w+)\s*:\s*(?:''|""|``|\[\]|0\b|null\b|false\b|true\b)/g,
];

function collectFormFields(content: string): Set<string> {
  const found = new Set<string>();
  for (const re of FORM_FIELD_PATTERNS) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) found.add(m[1].toLowerCase());
  }
  return found;
}

/** A create/edit screen: named like one AND actually rendering a form. */
function isEntityFormFile(path: string, content: string): boolean {
  if (isKitPath(path)) return false;
  const ext = extOf(path);
  if (ext !== '.tsx' && ext !== '.jsx') return false;
  if (!/(^|\/)(src\/pages|src\/components)\//i.test(path)) return false;
  if (!/(add|new|create|edit|update)/i.test(path)) return false;
  return (
    /<form\b/i.test(content) ||
    /onSubmit\s*=/.test(content) ||
    /<Input\b/.test(content)
  );
}

function entityFieldDriftIssues(
  files: Record<string, string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const shapes = collectEntityShapes(files);
  if (shapes.length === 0) return issues;

  for (const [path, content] of Object.entries(files)) {
    if (!isEntityFormFile(path, content)) continue;

    // Match the form to its entity: strongest signal is the form referencing
    // the type by name; otherwise fall back to the entity name in the path.
    const lowerPath = path.toLowerCase();
    const matched = shapes.filter(
      (s) =>
        new RegExp(`\\b${s.name}\\b`).test(content) ||
        lowerPath.includes(s.name.toLowerCase()),
    );
    if (matched.length !== 1) continue; // ambiguous → stay quiet

    const entity = matched[0];
    const formFields = collectFormFields(content);
    if (formFields.size < 2) continue; // couldn't read the form confidently

    const missing = entity.userFields.filter(
      (f) => !formFields.has(f.toLowerCase()),
    );
    // Tolerate a single omission; two or more is real drift.
    if (missing.length < 2) continue;

    issues.push({
      path,
      reason: 'entity-field-drift',
      detail:
        `create/edit form for ${entity.name} is missing input(s) for ${missing.join(', ')} ` +
        `— ${entity.name} (${entity.path}) defines ${entity.userFields.join(', ')}. ` +
        `Add an input for every user-supplied field, using the same field names`,
    });
  }

  return issues;
}

// ── Split data source (DB vs static mock) ───────────────────────────────────
// The "added it in admin but it never shows on the site" failure: one surface
// writes an entity to Supabase while another renders it from a static seed
// array. Precise by construction: it only fires when the SAME entity name is
// both a Supabase table (`.from('cars')`) and a static array export that a
// page still imports.

const SUPA_TABLE_RE = /\.from\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*\)/g;
const STATIC_EXPORT_RE = /export\s+const\s+(\w+)(?:\s*:\s*[^=]+)?=\s*\[/g;

/** Fold plural/singular + case so `cars` matches `Car` / `carList`-ish names. */
function foldEntityName(s: string): string {
  return s.toLowerCase().replace(/(list|data|items)$/, '').replace(/s$/, '');
}

function splitDataSourceIssues(
  files: Record<string, string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  // 1. Tables the app actually reads/writes through Supabase.
  const tables = new Map<string, string>(); // folded → raw table name
  for (const [path, content] of Object.entries(files)) {
    if (isKitPath(path)) continue;
    let m: RegExpExecArray | null;
    SUPA_TABLE_RE.lastIndex = 0;
    while ((m = SUPA_TABLE_RE.exec(content)) !== null) {
      tables.set(foldEntityName(m[1]), m[1]);
    }
  }
  if (tables.size === 0) return issues; // no DB usage → nothing to reconcile

  // 2. Static data modules exporting an array for one of those entities.
  const staticModules: Array<{ path: string; base: string; table: string }> =
    [];
  for (const [path, content] of Object.entries(files)) {
    if (!/(^|\/)src\/data\//.test(path)) continue;
    const base = (path.split('/').pop() ?? '').replace(/\.(tsx?|jsx?)$/, '');
    const names = new Set<string>([base]);
    let m: RegExpExecArray | null;
    STATIC_EXPORT_RE.lastIndex = 0;
    while ((m = STATIC_EXPORT_RE.exec(content)) !== null) names.add(m[1]);
    for (const n of names) {
      const table = tables.get(foldEntityName(n));
      if (table) {
        staticModules.push({ path, base, table });
        break;
      }
    }
  }

  // 3. Pages/components still importing those modules render stale data.
  for (const mod of staticModules) {
    for (const [path, content] of Object.entries(files)) {
      if (path === mod.path || isKitPath(path)) continue;
      const ext = extOf(path);
      if (ext !== '.tsx' && ext !== '.jsx') continue;
      const importRe = new RegExp(
        `from\\s+['"][^'"]*/data/${mod.base}['"]`,
      );
      if (!importRe.test(content)) continue;
      issues.push({
        path,
        reason: 'split-data-source',
        detail:
          `renders "${mod.table}" from the static module ${mod.path} while the app ` +
          `reads/writes the "${mod.table}" Supabase table elsewhere — records created in ` +
          `admin will never appear here. Replace the static import with the shared ` +
          `Supabase query, and move seed rows into the DB (__schema__.json sql INSERTs)`,
      });
    }
  }

  return issues;
}

// ── Admin shell leak ────────────────────────────────────────────────────────
// The back office is meant to be its own surface — sidebar, neutral, dense. It
// stops being one the moment an admin page renders the public marketing header
// or footer, which is what makes owners say "my admin looks like the customer
// site". Detected structurally: an admin page importing the public layout.

const PUBLIC_SHELL_IMPORT_RE =
  /import\s+(?:\{[^}]*\}|\w+)\s+from\s+['"][^'"]*(?:components\/layout\/(?:Header|Footer|Navbar|PublicLayout|SiteHeader|SiteFooter))['"]/;

const PUBLIC_SHELL_USAGE_RE = /<(Header|Footer|Navbar|PublicLayout|SiteHeader|SiteFooter)\b/;

function isAdminPagePath(path: string): boolean {
  return /(^|\/)src\/(pages|views|routes)\/admin\//i.test(path);
}

function adminShellLeakIssues(
  files: Record<string, string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  const adminPages = Object.keys(files).filter((p) => {
    if (isKitPath(p)) return false;
    const ext = extOf(p);
    if (ext !== '.tsx' && ext !== '.jsx') return false;
    return isAdminPagePath(p);
  });
  if (adminPages.length === 0) return issues; // no admin area → nothing to check

  for (const path of adminPages) {
    const content = files[path];
    if (!PUBLIC_SHELL_IMPORT_RE.test(content)) continue;
    if (!PUBLIC_SHELL_USAGE_RE.test(content)) continue;
    issues.push({
      path,
      reason: 'admin-shell-leak',
      detail:
        'admin page renders the public site header/footer — the back office must use its own ' +
        'AdminLayout (sidebar + compact top bar, neutral surfaces, full width) and never the ' +
        'marketing shell',
    });
  }

  // An admin area with no layout component at all is the same failure one step
  // earlier: nothing exists for those pages to sit inside.
  const hasAdminLayout = Object.keys(files).some((p) =>
    /(admin).*(layout)|layout.*(admin)/i.test(p.replace(/^.*\//, '')),
  );
  if (!hasAdminLayout && issues.length === 0) {
    issues.push({
      path: adminPages[0],
      reason: 'admin-shell-leak',
      detail:
        'the app has /admin pages but no AdminLayout component — add one (fixed sidebar with an ' +
        'entry per managed entity + Settings, compact top bar with "View site" and sign out) and ' +
        'render every admin route inside it',
    });
  }

  return issues;
}

function structuralIssues(
  files: Record<string, string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const routes = collectDefinedRoutes(files);

  // ── 1. Route ↔ link reconciliation ──
  // Only run when we found a real router (>=2 routes); otherwise the app may use
  // a routing pattern we don't parse and we'd emit false positives. We flag only
  // links whose TOP-LEVEL segment exists in no route at all — the reliable
  // "linked to a page that was never built" signal — tolerating nested-route
  // flattening and dynamic params.
  if (routes.count >= 2) {
    for (const [path, content] of Object.entries(files)) {
      if (isKitPath(path)) continue;
      const ext = extOf(path);
      if (ext !== '.tsx' && ext !== '.jsx') continue;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      LINK_TARGET_RE.lastIndex = 0;
      while ((m = LINK_TARGET_RE.exec(content)) !== null) {
        const target = m[1] ?? m[2] ?? m[3];
        if (!target || !target.startsWith('/')) continue; // internal absolute only
        if (target === '/') continue; // root virtually always exists
        const fs = firstSeg(target).toLowerCase();
        if (!fs || fs.startsWith(':')) continue; // fully-dynamic — can't verify
        if (routes.firstSegments.has(fs) || routes.allSegments.has(fs)) continue;
        if (seen.has(fs)) continue;
        seen.add(fs);
        issues.push({
          path,
          reason: 'broken-link',
          detail: `links to "${target}" but no route with segment "/${fs}" exists — create the page or fix the link`,
        });
      }
    }
  }

  // ── 2. Dead nav controls ──
  // (a) An action icon in the shell with NO interactivity anywhere in the file
  //     (a genuinely dead nav bar). Scoped to layout files to stay confident.
  const ACTION_ICON_RE =
    /\b(ShoppingCart|ShoppingBag|Search|User|Menu|Bell|Heart)\b/;
  for (const [path, content] of Object.entries(files)) {
    if (!/components\/layout\//i.test(path)) continue;
    if (!ACTION_ICON_RE.test(content)) continue;
    const hasInteractivity =
      /\b(to|href|onClick)\s*=/.test(content) ||
      /\bnavigate\(/.test(content) ||
      /<button\b/i.test(content) ||
      /<Link\b/.test(content) ||
      /<NavLink\b/.test(content);
    if (!hasInteractivity) {
      issues.push({
        path,
        reason: 'dead-control',
        detail:
          'header/nav renders an action icon (cart/search/user/menu) with no link or click handler — wire it to its destination',
      });
    }
  }

  // (b) Cart unreachable: the app clearly has a cart (context/state) but nothing
  //     routes or links to a cart/panier/basket page — the classic dead cart
  //     icon. Precise and low-false-positive: needs cart STATE to exist AND zero
  //     cart route/link anywhere.
  const cartStateExists = Object.values(files).some((c) =>
    /\b(CartContext|useCart|addToCart|itemCount|cartItems)\b/.test(c),
  );
  if (cartStateExists) {
    const cartReachable =
      routes.firstSegments.has('cart') ||
      routes.firstSegments.has('panier') ||
      routes.firstSegments.has('basket') ||
      routes.allSegments.has('cart') ||
      routes.allSegments.has('panier') ||
      routes.allSegments.has('basket') ||
      Object.values(files).some((c) =>
        /(?:to|href)\s*=\s*["'`]\/(cart|panier|basket)\b|navigate\(\s*["'`]\/(cart|panier|basket)\b/i.test(
          c,
        ),
      );
    if (!cartReachable) {
      // Attach to a layout/header file if present, else the cart state file.
      const layoutFile = Object.keys(files).find((p) =>
        /components\/layout\/(header|nav)/i.test(p),
      );
      const stateFile = Object.keys(files).find((p) =>
        /\b(CartContext|useCart)\b/.test(files[p]),
      );
      const target = layoutFile ?? stateFile;
      if (target) {
        issues.push({
          path: target,
          reason: 'dead-control',
          detail:
            'cart state exists but no cart page is reachable — add a /cart (panier) route + page and link the header cart icon to it',
        });
      }
    }
  }

  // ── 3. Thin pages ──
  // A page component with fewer than 2 block-level landmarks is almost always a
  // bare heading + paragraph. Skip error/404/loading pages, which are legitimately
  // sparse.
  const LANDMARK_RE =
    /<(section|main|article|header|form|table|ul|ol)\b|<(Card|Table|Stagger|Hero|Grid|Accordion|Tabs|Gallery|List|Modal|Chart|Board|Panel|Feed|Timeline)\b|<[A-Z]\w*(Table|List|Grid|Board|Panel|Section|Chart|Gallery|Feed|Form)\b/g;
  for (const [path, content] of Object.entries(files)) {
    if (isKitPath(path)) continue;
    if (!/src\/pages\//i.test(path)) continue;
    if (/(notfound|not-found|404|error|loading|redirect)/i.test(path)) continue;
    const ext = extOf(path);
    if (ext !== '.tsx' && ext !== '.jsx') continue;
    if (content.trim().length < 300) continue; // already caught by too-small
    // Landmarks + list-rendering loops both count as real content.
    const landmarks =
      (content.match(LANDMARK_RE)?.length ?? 0) +
      Math.min(3, (content.match(/\.map\(/g)?.length ?? 0));
    if (landmarks < 2) {
      issues.push({
        path,
        reason: 'thin-page',
        detail: `only ${landmarks} content section(s) — pages need at least 2 substantive sections (home ≥5)`,
      });
    }
  }

  // ── 4. Persistence ──
  // A context that manages a mutable collection (CRUD mutators over useState)
  // but no file in the tree touches localStorage → user data is lost on reload.
  const anyLocalStorage = Object.values(files).some((c) =>
    /localStorage/.test(c),
  );
  if (!anyLocalStorage) {
    for (const [path, content] of Object.entries(files)) {
      if (isKitPath(path)) continue;
      const looksLikeStore =
        /createContext|useState/.test(content) &&
        /\b(add|create|delete|remove|update|setItems|addToCart|addProduct)\w*/i.test(
          content,
        ) &&
        /useState<[^>]*\[\]|useState\(\s*\[|useState<[^>]*Array/.test(content);
      if (looksLikeStore) {
        issues.push({
          path,
          reason: 'no-persistence',
          detail:
            'manages mutable collection state but nothing persists to localStorage — hydrate on load + write on change so a reload keeps the data',
        });
        break; // one representative flag is enough to trigger the fix
      }
    }
  }

  // ── 5. Entity field contract drift ──
  // A create/edit form that collects fewer fields than its entity defines —
  // the "Add Car form asks for 3 of the card's 6 fields" failure.
  issues.push(...entityFieldDriftIssues(files));

  // ── 6. Split data source ──
  // An entity written to Supabase but rendered from a static mock module —
  // the "added it in admin but it never shows on the site" failure.
  issues.push(...splitDataSourceIssues(files));

  // ── 7. Admin shell leak ──
  // An admin page wearing the public marketing chrome — the "my admin looks
  // like the customer site" failure.
  issues.push(...adminShellLeakIssues(files));

  return issues;
}

export function evaluateCompleteness(
  files: Record<string, string>,
): CompletenessReport {
  const issues: CompletenessIssue[] = [];
  const stubPathSet = new Set<string>();

  // Missing-mandatory check
  const missing: string[] = [];
  for (const m of MANDATORY_FILES) {
    if (!(m in files) || files[m].trim().length === 0) {
      missing.push(m);
      issues.push({
        path: m,
        reason: 'missing-mandatory',
        detail: 'mandatory file is missing or empty',
      });
      stubPathSet.add(m);
    }
  }

  for (const [path, raw] of Object.entries(files)) {
    // Skip kit files — they are injected by the backend and known correct.
    if (isKitPath(path)) continue;

    const content = raw ?? '';
    if (content.trim().length === 0) {
      issues.push({ path, reason: 'empty', detail: 'file is empty' });
      stubPathSet.add(path);
      continue;
    }

    const ext = extOf(path);
    const minBytes = MIN_BYTES_BY_EXT[ext];
    if (minBytes !== undefined && content.length < minBytes) {
      // Skip the size check for very small but legitimate files (e.g. barrel exports).
      const hasOnlyExports = /^[\s]*export\s+\*\s+from/m.test(content);
      if (!hasOnlyExports) {
        issues.push({
          path,
          reason: 'too-small',
          detail: `${content.length} bytes, floor for ${ext} is ${minBytes}`,
        });
        stubPathSet.add(path);
      }
    }

    for (const re of STUB_TEXT_PATTERNS) {
      const m = content.match(re);
      if (m) {
        issues.push({
          path,
          reason: 'stub-text',
          detail: `matched placeholder text: ${m[0]}`,
        });
        stubPathSet.add(path);
        break;
      }
    }

    for (const re of STUB_COMMENT_PATTERNS) {
      const m = content.match(re);
      if (m) {
        issues.push({
          path,
          reason: 'stub-comment',
          detail: `matched stub comment: ${m[0].slice(0, 80)}`,
        });
        stubPathSet.add(path);
        break;
      }
    }

    if ((ext === '.tsx' || ext === '.jsx') && isPlaceholderOnly(content)) {
      issues.push({
        path,
        reason: 'placeholder-only',
        detail: 'heavy on headings, no real components — looks like a stub layout',
      });
      stubPathSet.add(path);
    }

    // Detect files that redefine a UI kit primitive outside the kit directory.
    // The kit provides Button, Card, Input, Modal, Table, EmptyState, Skeleton, Toast, cn.
    // If the AI redefines one, it breaks the consistency guarantee.
    if (
      (ext === '.tsx' || ext === '.ts') &&
      !isKitPath(path)
    ) {
      const KIT_RE =
        /export\s+(?:default\s+)?(?:function|const)\s+(Button|Card|Input|Modal|Table|EmptyState|Skeleton|Toast|Tabs|Accordion|Breadcrumbs|Pagination|Avatar|StatCard|RatingStars|QuantityStepper|Drawer)\b/;
      const kitMatch = content.match(KIT_RE);
      if (kitMatch) {
        issues.push({
          path,
          reason: 'redefines-kit-primitive',
          detail: `redefines UI kit primitive: ${kitMatch[1]}`,
        });
        // Don't add to stubPaths — this isn't a stub, it's a duplication issue.
      }

      // Catch cn() redefinition — should import from @/lib/cn, not redefine
      if (
        path !== 'src/lib/cn.ts' &&
        /export\s+(?:function|const)\s+cn\b/.test(content)
      ) {
        issues.push({
          path,
          reason: 'redefines-kit-primitive',
          detail: 'redefines cn() utility — import from @/lib/cn instead',
        });
      }
    }
  }

  // ── Cross-file structural pass ──
  // Routes linked-but-never-created, dead nav controls, thin pages, and
  // unpersisted CRUD state. These target files for enrichment (added to
  // stubPaths) so the cleanup round fixes them in place.
  for (const issue of structuralIssues(files)) {
    issues.push(issue);
    stubPathSet.add(issue.path);
  }

  return {
    ok: issues.length === 0,
    issues,
    stubPaths: [...stubPathSet],
    missing,
  };
}

/** Hint text for Cursor cleanup when the completeness gate flags stub content. */
export function formatCompletenessHintForCursor(
  report: CompletenessReport,
): string {
  if (report.ok) return '';
  const lines = report.issues.slice(0, 30).map((i) => `  - ${i.path}: ${i.detail}`);
  return [
    'CONTENT & COMPLETENESS (high priority before Vercel):',
    'These files are placeholders, too thin, or structurally incomplete (dead links,',
    'dead nav controls, bare pages, unpersisted state, or forms that collect fewer',
    'fields than their entity defines). Fix each: brief-specific, production-quality',
    'copy and full UI, working navigation, and localStorage-backed state — not generic',
    'marketing stubs.',
    '',
    'Do NOT ship:',
    '  - "Welcome to Our App", "Description of feature one/two", "Feature One/Two/Three"',
    '  - Lorem ipsum, TODO/FIXME stubs, `{/* Components like X */}` comments',
    '  - Pages with fewer than ~3 substantive sections or unrealistically tiny components',
    '',
    ENTITY_PARITY_FOR_FIX,
    '',
    DB_SYNC_FOR_FIX,
    '',
    'Flagged paths:',
    ...lines,
  ].join('\n');
}

// ── Scorecard ────────────────────────────────────────────────────────────────

export interface CompletenessScorecard {
  archetype: string;
  routesFound: number;
  minPages: number;
  /** Structural + stub issue counts, keyed by reason. */
  counts: Partial<Record<StubReason, number>>;
  /** 0–100 completeness score (100 = clean, meets the archetype floor). */
  score: number;
}

const ISSUE_PENALTY: Partial<Record<StubReason, number>> = {
  'missing-mandatory': 8,
  'too-small': 5,
  'stub-text': 5,
  'stub-comment': 5,
  'placeholder-only': 6,
  empty: 8,
  'broken-link': 8,
  'dead-control': 10,
  'thin-page': 6,
  'no-persistence': 8,
  'entity-field-drift': 10,
  'split-data-source': 10,
  'admin-shell-leak': 8,
  'redefines-kit-primitive': 3,
};

/**
 * Turn a completeness evaluation into a single measurable score, so "does every
 * generated site look complete?" becomes a number we can log per build and
 * watch across releases. Pure and cheap — no extra LLM/deploy cost.
 */
export function buildCompletenessScorecard(
  files: Record<string, string>,
  projectIdea: string,
): CompletenessScorecard {
  const report = evaluateCompleteness(files);
  const archetype = detectArchetype(projectIdea);
  const routesFound = collectDefinedRoutes(files).firstSegments.size;

  const counts: Partial<Record<StubReason, number>> = {};
  let penalty = 0;
  for (const issue of report.issues) {
    counts[issue.reason] = (counts[issue.reason] ?? 0) + 1;
    penalty += ISSUE_PENALTY[issue.reason] ?? 4;
  }
  // Under the archetype's page floor is its own penalty (missing whole screens).
  if (routesFound < archetype.minPages) {
    penalty += (archetype.minPages - routesFound) * 4;
  }

  return {
    archetype: archetype.id,
    routesFound,
    minPages: archetype.minPages,
    counts,
    score: Math.max(0, Math.min(100, 100 - penalty)),
  };
}
