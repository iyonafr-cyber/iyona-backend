/**
 * Canonical build rules shared by the plan prompt (the "brain") and the Cursor
 * agent prompts (the "worker"), plus the post-build completeness gate.
 *
 * WHY THIS EXISTS: these three rules cover the failures that make a generated
 * app feel broken to a non-developer, so they are deliberately restated at every
 * stage that can catch them — planning, building, cleanup, chat edits, and the
 * static gate. The redundancy is the point. What was NOT the point is that each
 * stage had its own hand-written phrasing: four descriptions of entity parity
 * that could drift apart, so a rule tightened in the plan prompt silently stayed
 * loose in the repair prompt.
 *
 * The fix is to separate substance from speech act. The SUBSTANCE of each rule —
 * what is required, and the concrete failure it prevents — is defined once, in
 * the atoms below. Each stage then wraps those atoms in its own verb: the brain
 * is told to SPECIFY, the worker to IMPLEMENT, a fix round to REPAIR. One
 * definition, three framings, no drift.
 */

// ── Atoms: the substance, defined once ──────────────────────────────────────

/** The concrete failure every phrasing of the parity rule points at. */
const PARITY_FAILURE =
  'an entity whose card renders image, title, model, year, condition and description while its "Add" form only asks for name, year and price';

/** What parity actually requires, independent of who is being told. */
const PARITY_REQUIREMENTS = [
  'The create form AND the edit form must each contain an input for EVERY field marked `user` — not a subset, not "the important ones".',
  'Fields marked `system` (id, createdAt, updatedAt, slug, computed ratings/counts) are the ONLY ones a form may omit.',
  'ONE name per field on every surface: never display `title` but collect `name`, or display `condition` but store `state`. The same name goes in the TypeScript type, the seed data, the create form, the edit form, the card, the detail page, the filters, and the DB schema.',
  'Image-bearing entities: if the card or detail page shows an image, the form collects it (a URL input with a sensible default) and every seed record populates it.',
];

/** The failure the DB-sync rule prevents, in the owner's own words. */
const SPLIT_BRAIN_FAILURE =
  'the owner reports "the content I add in admin never shows on the site" — one surface reads the database while another renders a static array or localStorage';

/** What single-source-of-truth data access requires. */
const DB_SYNC_REQUIREMENTS = [
  'ONE data module per entity (src/lib/api/<entity>.ts, typed list/get/create/update/remove over the shared Supabase client). EVERY surface — public list and detail pages, admin screens, filters — goes through those functions.',
  'No page renders a CRUD entity from a static array or localStorage when that entity has a Supabase table.',
  'Seed records are INSERTed into the database (via __schema__.json `sql`, INSERT ... ON CONFLICT DO NOTHING) — never shipped as module constants that pages render directly.',
  'After every create/update/delete, refetch the affected list or update the shared context so the change is visible on every surface immediately.',
];

/** What separates a back office from more public pages. */
const ADMIN_REQUIREMENTS = [
  'Its own AdminLayout: fixed left sidebar (dashboard, one link per managed entity, Settings) and a compact top bar with the signed-in admin, a "View site" link to /, and sign out. Every /admin/* route renders inside it.',
  'NEVER the public Header, Footer, hero or marketing chrome on an admin route, and the public layout never wraps an /admin route. An import of components/layout/Header inside pages/admin/ is the bug.',
  'Neutral and utilitarian: neutral grey/near-white surfaces, compact spacing, small type, real Tables with search, sortable columns, pagination and row actions. Full width, not the marketing container. The brand palette appears ONLY on primary buttons, links and status badges — no gradients, no hero imagery, no marketing copy.',
  'The full route set for EVERY stored entity: /admin/<entity>, /admin/<entity>/new, /admin/<entity>/:id/edit (edit + delete behind a confirm), plus /admin and /admin/settings. An entity a visitor can see but the admin cannot edit is an incomplete app.',
  '/admin/settings edits REAL data the public site reads — contact details, branding, social links, the business rules in use, and the Privacy Policy / Terms copy that /privacy and /terms render. Persist to the site_settings table when there is a database (localStorage only for mock-data apps) and read it everywhere through one useSiteConfig() hook.',
  'Admins sign in at the SAME /login as customers and are redirected to /admin; customers go to the home page. No separate admin login, no admin signup.',
  'The public site is the showpiece and must look designed; the admin is a tool and must be plain but COMPLETE. Simple is right; missing features are not.',
];

const bullets = (lines: string[], prefix = '- '): string =>
  lines.map((l) => `${prefix}${l}`).join('\n');

// ── Images that actually load ────────────────────────────────────────────────

/**
 * Broken OR irrelevant images are the most visible defect to a non-developer
 * judging a live preview. Two failure modes, both prompt-caused:
 *   1. Broken: `source.unsplash.com/?<kw>` (deprecated, 404s) or fabricated
 *      `images.unsplash.com` ids.
 *   2. Irrelevant: subject-random services (picsum) — a barber shop rendered
 *      nature/swimming photos because the seed only pins WHICH random photo.
 * The fix for both is the same: a curated VERIFIED IMAGE LIBRARY (see
 * stock-images.ts) injected into the prompt — every URL confirmed to load and
 * labeled with its subject — plus an onError fallback so even an unexpected
 * failure never shows the browser's broken-image icon.
 */
const IMAGE_REQUIREMENTS = [
  'RELEVANCE IS THE BAR: every image must match the product domain AND the section it sits in — a barber site shows barbering, a menu section shows food. One off-topic photo (random nature on a barber page) is as bad as a broken one.',
  'SOURCE: use ONLY the URLs in the VERIFIED IMAGE LIBRARY block in this prompt — each is confirmed to load and labeled with its subject. Pick by label. Vary sizes via the `w=` query param (1600 hero / 800 card / 400 thumb).',
  'NEVER use `source.unsplash.com/...` (deprecated — it fails), NEVER use an `images.unsplash.com` id that is not in the library (a guessed id is a broken image), NEVER hotlink arbitrary third-party images.',
  '`https://picsum.photos/seed/<slug>/<w>/<h>` is allowed ONLY for purely decorative abstract backgrounds where the subject genuinely does not matter — never for products, services, people, places, or any content imagery (it serves random photos). Prefer the library\'s abstract-gradient entries even for those.',
  'EVERY `<img>` MUST set explicit width & height (reserve space, avoid layout shift) AND an `onError` handler that swaps to a neutral fallback (a solid surface-coloured block or inline SVG) so a failed load never shows a broken-image icon.',
  "NEVER hand-draw representational artwork to fill an image gap — no SVG/CSS/canvas illustrations of products, food, faces, vehicles or buildings. A model-drawn product render reads as broken, not stylish. When the library has no image for the product, use a typographic tile (item name in the display type on a token surface, category eyebrow, hairline border) — a deliberate design choice beats a bad drawing.",
  'People: use the library\'s portrait entries for testimonials/team; use the kit `<Avatar>` (initials) for signed-in users and dynamic accounts.',
  'A local asset path (`src/assets/...`, `/public/...`) is valid ONLY if you actually create that file. Route recurring imagery (logo, hero, og) through `siteConfig`.',
];

/** For the plan prompt: SPECIFY concrete, loadable, on-topic image URLs. */
export const IMAGE_SOURCES_FOR_PLAN = [
  'IMAGES (must load AND match the domain — assign concrete URLs from the library below, never vague "Unsplash keywords"):',
  bullets(IMAGE_REQUIREMENTS),
  '- In section 5, assign a specific library URL to every image slot the pages need (hero, cards, seed records) so the worker never has to choose blind.',
].join('\n');

/** For the full-build worker: every emitted image must resolve and fit. */
export const IMAGE_SOURCES_FOR_WORKER = [
  'IMAGES (every URL must resolve AND match its section — broken or off-topic imagery fails the visual bar):',
  bullets(IMAGE_REQUIREMENTS),
].join('\n');

/** For fix rounds: REPAIR broken OR off-topic images. */
export const IMAGE_SOURCES_FOR_FIX = [
  'IMAGES: an image is defective if it fails to load OR does not match its context (e.g. nature photos on a barber site).',
  'Replace any `source.unsplash.com/...` URL, any guessed/dead `images.unsplash.com` id, and any off-topic photo with an on-topic image already used elsewhere in the repo (check siteConfig and seed data for the vetted set), and add an `onError` fallback to every `<img>`.',
  'Do NOT introduce new random-image services (picsum for content imagery) — subject-random photos are how off-topic imagery got in.',
].join(' ');

// ── Entity field parity ─────────────────────────────────────────────────────

/** For the plan prompt: SPECIFY the contract. */
export const ENTITY_PARITY_FOR_PLAN = [
  'ENTITY FIELD CONTRACT (mandatory — one table per CRUD entity, and it is BINDING):',
  'For every entity the app creates, lists, or edits, give ONE canonical field table. That table is the single source of truth for the entity across the whole app — the seed data, the DB schema, and EVERY screen that reads or writes it must use exactly these field names.',
  '',
  '| field | type | required | source |',
  'Where **source** is exactly one of: `user` (the person fills it in on a create/edit form) or `system` (generated automatically — id, createdAt, updatedAt, slug, computed ratings/counts).',
  '',
  'Then state the surfaces in one line per entity, e.g.:',
  '"Car — card shows image, title, model, year, condition, price; detail shows all fields; create/edit form has EVERY `user` field; filters use model, year, condition."',
  '',
  'CROSS-SURFACE PARITY (the #1 quality failure — get this right):',
  bullets(PARITY_REQUIREMENTS),
  `- A plan that specifies ${PARITY_FAILURE} describes a BROKEN app.`,
  '- The detail page renders every field in the table (`user` and `system`) unless the table says otherwise.',
  "- List the entity's TypeScript interface file (e.g. src/types/car.ts, or the data module that exports it) in the section-7 file map, and have the form, card, detail page and seed data all import that ONE type — so a field mismatch is a compile error rather than a silent gap.",
].join('\n');

/** For the full-build worker: IMPLEMENT the contract. */
export const ENTITY_PARITY_FOR_WORKER = [
  'ENTITY FIELD CONTRACT (cross-surface parity — the #1 thing that makes a generated app feel broken):',
  'The plan\'s "Data & state" section gives one canonical field table per CRUD entity. That table is binding. For EVERY entity:',
  '- Define the entity ONCE as a TypeScript interface at the path the plan names, and import that same type in the seed data, the create form, the edit form, the card, the detail page and any filters. One type, imported everywhere — so a field mismatch is a compile error instead of a silent gap.',
  bullets(PARITY_REQUIREMENTS),
  `- The failure to avoid, concretely: ${PARITY_FAILURE}.`,
  "- After building each entity's screens, re-read the field table and the form side by side and add anything you dropped.",
].join('\n');

/** For fix rounds (cleanup, chat edits): REPAIR drift in an existing tree. */
export const ENTITY_PARITY_FOR_FIX = [
  "ENTITY FIELD PARITY: for each CRUD entity, the create and edit forms must each have an input for EVERY user-supplied field the entity's type, seed data, card and detail page use — only auto-generated fields (id, createdAt, slug, computed counts) may be missing.",
  `${PARITY_FAILURE.charAt(0).toUpperCase()}${PARITY_FAILURE.slice(1)} is a bug: add the missing inputs, keep ONE name per field across every surface, and make sure every seed record fills every field.`,
  "When a change touches an entity's fields, update EVERY surface in the same edit — the type, the seed data, both forms, the card, the detail page, any filters, and __schema__.json if it exists. Adding a field means adding its input AND its display AND populating it in the seed records; renaming means renaming everywhere.",
].join(' ');

// ── Database sync ───────────────────────────────────────────────────────────

/** For the plan prompt: SPECIFY where data lives. */
export const DB_SYNC_FOR_PLAN = [
  bullets(DB_SYNC_REQUIREMENTS),
  `- Getting this wrong is the split-brain bug: ${SPLIT_BRAIN_FAILURE}.`,
].join('\n');

/** For the full-build worker: IMPLEMENT single-source data access. */
export const DB_SYNC_FOR_WORKER = [
  'DATABASE SYNC (when the plan wires Supabase — the #2 "app feels broken" failure):',
  `Every surface that reads or writes an entity must use the SAME Supabase table through the plan's shared data module. The classic bug: ${SPLIT_BRAIN_FAILURE}.`,
  bullets(DB_SYNC_REQUIREMENTS),
  '- Do not fall back to localStorage for entities the plan puts in Supabase.',
].join('\n');

/** For fix rounds: REPAIR a split data source. */
export const DB_SYNC_FOR_FIX = [
  'DATABASE SYNC: when the project has Supabase wired (a supabase client module / VITE_SUPABASE_URL), ALL reads and writes for an entity go through its shared Supabase data module.',
  `If the user reports content "not updating" or "not showing" on one side, the cause is almost always a split data source — ${SPLIT_BRAIN_FAILURE}.`,
  'Fix it by putting BOTH surfaces on the same Supabase table and refetching after writes. NEVER fix a not-showing bug by hardcoding data.',
].join(' ');

// ── Admin surface ───────────────────────────────────────────────────────────

/** For the plan prompt: SPECIFY the back office as a separate surface. */
export const ADMIN_FOR_PLAN = [
  'IF THE APP HAS AN /admin AREA, describe its shell SEPARATELY and state plainly that the two never mix. The back office is a different surface, not more public pages:',
  bullets(ADMIN_REQUIREMENTS),
  '- Name both layout files in the section-7 file map, plan each admin route as its own subsection in section 5, and list every one in the section-7 routing table. Never describe an admin screen with the public page scaffold.',
].join('\n');

/** For the full-build worker: BUILD the back office. */
export const ADMIN_FOR_WORKER = [
  'ADMIN PANEL (when the plan has /admin routes — the back office is a DIFFERENT SURFACE, not more public pages):',
  bullets(ADMIN_REQUIREMENTS),
].join('\n');

// ── Self-check variants: VERIFY the rule holds, before finishing ────────────

/** Used by the worker's pre-PR checklist and the plan's pre-response check. */
export const ENTITY_PARITY_SELF_CHECK =
  "ENTITY FIELD CONTRACT: for each CRUD entity, put its field table next to the create form, the edit form, the card and the detail page. Every field marked `user` appears as an input in BOTH forms, with the SAME name on every surface, and no form collects a field that isn't in the table. This is the single most common defect — check it field by field, not at a glance.";

/** Trace-one-entity check for Supabase-backed apps. */
export const DB_SYNC_SELF_CHECK =
  'DATABASE SYNC (Supabase apps only): trace one entity end to end — the create form inserts into the Supabase table, and the PUBLIC list page reads that same table through the same data module. If any public page renders the entity from a static array, that is the "added in admin, never shows on the site" bug: replace it with the DB query. Confirm seed rows are INSERTed via __schema__.json, not shipped as module constants.';
