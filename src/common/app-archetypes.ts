/**
 * App archetypes — the single source of truth for what makes each *type* of
 * generated website "complete".
 *
 * The generation pipeline is a strict brain→worker contract: the LLM writes a
 * development plan and the Cursor agent implements it verbatim, never inventing
 * pages. That means completeness can only come from the plan — so we define,
 * per product category, the minimum page manifest a plan MUST contain.
 *
 * Consumed in two places:
 *   1. AiService.buildBuildSpecPrompt — injects the manifest so the brain plans
 *      every mandatory screen (prompt-time, best effort).
 *   2. SpecBuildService plan lint — verifies the produced brief actually covers
 *      the manifest before it becomes a binding contract (deploy-time, enforced).
 *
 * Detection and lint patterns are intentionally bilingual (English + French):
 * user prompts and generated copy are often French, and the model does not
 * always keep routes ASCII-English despite instructions.
 */

import {
  lintPlanEntityContracts,
  formatEntityViolationsForRepair,
  type EntityContractViolation,
} from './plan-entity-contract';

export interface ArchetypePage {
  /** Stable key for logging / scorecards. */
  key: string;
  /** Human label rendered into the plan prompt's manifest block. */
  label: string;
  /**
   * Evidence patterns for the lint. If NONE match the brief text, the page is
   * considered missing. Kept broad so a plan that mentions the concept anywhere
   * (route, component name, or heading) passes — the lint targets gross
   * omissions (no cart at all, no auth at all), not wording nitpicks.
   */
  patterns: RegExp[];
}

export interface AppArchetype {
  id: string;
  label: string;
  /** Minimum distinct routes a complete plan of this type should have. */
  minPages: number;
  /** Mandatory screens; each must have supporting evidence in the plan. */
  pages: ArchetypePage[];
  /** Archetype-specific prescriptive lines injected into the plan prompt. */
  guidance: string[];
}

// ── Shared page definitions ─────────────────────────────────────────────────

const AUTH_LOGIN: ArchetypePage = {
  key: 'login',
  label:
    'Login page: email + password form, "demo credentials" hint on the card, link to signup, redirects to the guarded area on success',
  patterns: [
    /\b(login|log-?in|sign-?in|connexion|se connecter|authentif)/i,
    /\/(login|signin|connexion|auth)\b/i,
  ],
};

const AUTH_SIGNUP: ArchetypePage = {
  key: 'signup',
  label:
    'Signup page: registration form (name, email, password, role where relevant), link back to login',
  patterns: [
    /\b(signup|sign-?up|register|registration|inscription|s'inscrire|créer un compte|create an? account)/i,
    /\/(signup|register|inscription)\b/i,
  ],
};

// ── Archetype registry ──────────────────────────────────────────────────────

const ARCHETYPES: Record<string, AppArchetype> = {
  ecommerce: {
    id: 'ecommerce',
    label: 'E-commerce store',
    minPages: 10,
    pages: [
      {
        key: 'home',
        label:
          'Storefront home: image-led hero, featured/best-seller products, category tiles, social proof/testimonials, newsletter band (≥5 distinct sections)',
        patterns: [/\b(home|homepage|storefront|accueil|vitrine|landing)\b/i, /\/($|"|`|\s)/],
      },
      {
        key: 'catalog',
        label:
          'Product catalog: responsive card GRID (never a data table) with category + price filters, sort, search, and pagination',
        patterns: [
          /\b(catalog|catalogue|shop|store|products?|produits?|boutique|collection|listing)\b/i,
        ],
      },
      {
        key: 'productDetail',
        label:
          'Product detail: multi-image gallery, size & colour variants, quantity stepper, rating stars, add-to-cart, related products',
        patterns: [
          /\b(product detail|product page|détail produit|fiche produit|product-detail)\b/i,
          /\/[\w-]*\/:(id|productid|slug|handle)\b/i,
          /:id\b/i,
        ],
      },
      {
        key: 'cart',
        label:
          'Cart: line items with quantity edit + remove, order summary/totals, reachable from a clickable header cart icon',
        patterns: [/\b(cart|panier|basket)\b/i],
      },
      {
        key: 'checkout',
        label:
          'Checkout: multi-step (shipping → payment mock → review) ending in an order confirmation screen',
        patterns: [/\b(checkout|paiement|caisse|commander|order confirmation|confirmation de commande)\b/i],
      },
      AUTH_LOGIN,
      AUTH_SIGNUP,
      {
        key: 'account',
        label: 'Account: profile details + order history list',
        patterns: [/\b(account|profile|compte|mon compte|orders|commandes|order history|historique)\b/i],
      },
      {
        key: 'admin',
        label:
          'Admin (role-guarded, admin only): stats dashboard, product CRUD table, orders list',
        patterns: [/\b(admin|administration|back-?office|gestion|tableau de bord)\b/i],
      },
    ],
    guidance: [
      'Customer-facing product lists are card grids; reserve the Table primitive for the admin back-office only.',
      'Seed at least 18–24 products with realistic names, prices, categories, sizes/colours and distinct imagery.',
      'The header cart icon MUST link to the cart route — never a dead icon.',
    ],
  },

  saas: {
    id: 'saas',
    label: 'SaaS / dashboard app',
    minPages: 8,
    pages: [
      {
        key: 'landing',
        label: 'Marketing landing: hero, feature highlights, social proof, CTA (≥5 sections)',
        patterns: [/\b(landing|home|accueil|hero|marketing)\b/i],
      },
      {
        key: 'pricing',
        label: 'Pricing: tiered plan cards with feature comparison and CTAs',
        patterns: [/\b(pricing|plans?|tarifs?|abonnement|subscription)\b/i],
      },
      AUTH_LOGIN,
      AUTH_SIGNUP,
      {
        key: 'dashboard',
        label: 'Dashboard (guarded): stat cards, charts, recent activity',
        patterns: [/\b(dashboard|tableau de bord|overview|analytics|accueil de l'app)\b/i],
      },
      {
        key: 'entityList',
        label: 'At least one entity list + detail + create/edit flow (the app\'s core CRUD object)',
        patterns: [/\b(list|table|manage|gestion|détail|detail|create|nouvelle?|new|edit|modifier)\b/i],
      },
      {
        key: 'settings',
        label: 'Settings / profile: account form, preferences',
        patterns: [/\b(settings|paramètres|profile|profil|preferences|préférences|compte)\b/i],
      },
    ],
    guidance: [
      'Use stat/metric cards and charts on the dashboard — not a bare table.',
      'Guard every in-app route behind mock auth; the marketing landing + pricing stay public.',
    ],
  },

  marketing: {
    id: 'marketing',
    label: 'Marketing / business website',
    minPages: 5,
    pages: [
      {
        key: 'home',
        label:
          'Home: hero, feature/benefit sections, social proof, pricing or offer, FAQ, closing CTA (≥6 sections)',
        patterns: [/\b(home|homepage|accueil|hero|landing)\b/i],
      },
      {
        key: 'about',
        label: 'About: story, team, values',
        patterns: [/\b(about|à propos|our story|team|équipe|company|entreprise)\b/i],
      },
      {
        key: 'services',
        label: 'Services/Features: detailed offering breakdown with cards',
        patterns: [/\b(services?|features?|solutions?|offres?|prestations?|fonctionnalités?)\b/i],
      },
      {
        key: 'contact',
        label: 'Contact: working (mock) contact form + business details/map',
        patterns: [/\b(contact|nous contacter|get in touch|contactez)\b/i],
      },
      {
        key: 'blog',
        label: 'Blog/News: article index and article page',
        patterns: [/\b(blog|news|actualités|articles?|journal|magazine|resources|ressources)\b/i],
      },
    ],
    guidance: [
      'The home page must carry real visual weight: imagery or gradient art in the hero, multiple varied sections — never text on a flat colour.',
    ],
  },

  portfolio: {
    id: 'portfolio',
    label: 'Portfolio / personal site',
    minPages: 5,
    pages: [
      {
        key: 'home',
        label: 'Home: hero intro, selected work preview, skills/services',
        patterns: [/\b(home|accueil|intro|hero)\b/i],
      },
      {
        key: 'work',
        label: 'Work/Projects index: gallery grid of projects',
        patterns: [/\b(work|projects?|portfolio|projets?|réalisations?|gallery|galerie|case studies)\b/i],
      },
      {
        key: 'caseStudy',
        label: 'Project/case-study detail: hero image, problem/solution, gallery',
        patterns: [/\b(case study|project detail|détail projet|étude de cas)\b/i, /:(id|slug)\b/i],
      },
      {
        key: 'about',
        label: 'About: bio, experience, skills',
        patterns: [/\b(about|à propos|bio|resume|cv|parcours)\b/i],
      },
      {
        key: 'contact',
        label: 'Contact: form or contact details + social links',
        patterns: [/\b(contact|nous contacter|contactez|get in touch)\b/i],
      },
    ],
    guidance: ['Lean on imagery and generous whitespace; every project needs a real thumbnail.'],
  },

  blog: {
    id: 'blog',
    label: 'Blog / content site',
    minPages: 5,
    pages: [
      {
        key: 'home',
        label: 'Home: featured article + recent posts grid',
        patterns: [/\b(home|accueil|featured|à la une)\b/i],
      },
      {
        key: 'index',
        label: 'Article index: post cards with category filter + search',
        patterns: [/\b(articles?|posts?|blog|index|archive|actualités)\b/i],
      },
      {
        key: 'article',
        label: 'Article page: rich typographic layout, author, related posts',
        patterns: [/\b(article|post|détail)\b/i, /:(id|slug)\b/i],
      },
      {
        key: 'about',
        label: 'About: publication/author description',
        patterns: [/\b(about|à propos|author|auteur)\b/i],
      },
      {
        key: 'category',
        label: 'Category/tag page or author page',
        patterns: [/\b(category|categories|catégorie|tag|topic|rubrique|author|auteur)\b/i],
      },
    ],
    guidance: ['Article pages need real long-form typography, not a heading + one paragraph.'],
  },

  booking: {
    id: 'booking',
    label: 'Booking / services business',
    minPages: 6,
    pages: [
      {
        key: 'home',
        label: 'Home: hero, offering highlights, testimonials, CTA to book',
        patterns: [/\b(home|accueil|hero)\b/i],
      },
      {
        key: 'services',
        label: 'Services/menu index + detail: cards with prices/durations',
        patterns: [/\b(services?|menu|prestations?|offres?|treatments?|rooms?|chambres?)\b/i],
      },
      {
        key: 'booking',
        label: 'Booking flow: date/time/slot selection → details → confirmation',
        patterns: [/\b(book|booking|reserve|reservation|réserv|rendez-?vous|appointment|order)\b/i],
      },
      {
        key: 'confirmation',
        label: 'Confirmation: booking recap screen',
        patterns: [/\b(confirmation|confirmed|confirmé|recap|récapitulatif|success|merci)\b/i],
      },
      {
        key: 'contact',
        label: 'Contact/location: address, hours, map, form',
        patterns: [/\b(contact|location|adresse|hours|horaires|find us|nous trouver)\b/i],
      },
      {
        key: 'admin',
        label: 'Admin (guarded): manage bookings/availability',
        patterns: [/\b(admin|administration|manage|gestion|dashboard|back-?office)\b/i],
      },
    ],
    guidance: ['The booking flow must reach a confirmation screen — not dead-end on a form.'],
  },

  community: {
    id: 'community',
    label: 'Community / social app',
    minPages: 6,
    pages: [
      {
        key: 'feed',
        label: 'Feed/home: post stream with author, reactions, timestamps',
        patterns: [/\b(feed|timeline|home|accueil|stream|fil)\b/i],
      },
      {
        key: 'post',
        label: 'Post/thread detail: full post + comments',
        patterns: [/\b(post|thread|détail|discussion|comment|commentaires?)\b/i, /:(id|slug)\b/i],
      },
      {
        key: 'profile',
        label: 'User profile: avatar, bio, their posts',
        patterns: [/\b(profile|profil|user|utilisateur|member|membre)\b/i],
      },
      AUTH_LOGIN,
      AUTH_SIGNUP,
      {
        key: 'create',
        label: 'Create post/content flow',
        patterns: [/\b(create|nouveau|nouvelle|new post|compose|publier|post)\b/i],
      },
    ],
    guidance: ['Seed a believable feed of 10+ posts from distinct users with avatars.'],
  },
};

// Fallback when detection is inconclusive — a generic multi-page site.
const DEFAULT_ARCHETYPE = ARCHETYPES.marketing;

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Keyword scores per archetype. Longer/more specific terms carry more weight.
 * Bilingual on purpose. Order-independent; highest total score wins.
 */
const DETECTION_KEYWORDS: Record<string, Array<[RegExp, number]>> = {
  ecommerce: [
    [/\b(e-?commerce|online store|webshop|boutique en ligne)\b/i, 5],
    [/\b(shop|store|boutique|magasin|marketplace)\b/i, 2],
    [/\b(sell|selling|vendre|vente|acheter|buy)\b/i, 2],
    [/\b(products?|produits?|catalog|catalogue|cart|panier|checkout)\b/i, 2],
    [/\b(clothes|clothing|vêtements?|chaussures?|shoes|fashion|mode)\b/i, 2],
  ],
  saas: [
    [/\b(saas|dashboard|admin panel|control panel|back-?office)\b/i, 4],
    [/\b(analytics|crm|erp|management (app|tool|system)|gestion)\b/i, 3],
    [/\b(subscription|abonnement|multi-?tenant|workspace)\b/i, 2],
    [/\b(tableau de bord|kpi|metrics|métriques?)\b/i, 2],
  ],
  marketing: [
    [/\b(landing page|marketing site|business (site|website)|site vitrine|vitrine)\b/i, 4],
    [/\b(agency|agence|startup|company|entreprise|brand|marque)\b/i, 2],
    [/\b(services?|solutions?|présentation)\b/i, 1],
  ],
  portfolio: [
    [/\b(portfolio|personal (site|website)|site personnel)\b/i, 5],
    [/\b(photographer|designer|freelance|artist|artiste|architect)\b/i, 2],
    [/\b(resume|cv|réalisations?|projets? personnels?)\b/i, 2],
  ],
  blog: [
    [/\b(blog|magazine|news site|publication|journal|newsletter site)\b/i, 5],
    [/\b(articles?|posts?|actualités|content site)\b/i, 2],
  ],
  booking: [
    [/\b(booking|reservation|réservation|appointment|rendez-?vous)\b/i, 5],
    [/\b(restaurant|salon|hotel|hôtel|clinic|clinique|spa|coach)\b/i, 3],
    [/\b(schedule|calendar|agenda|slot|créneau)\b/i, 2],
  ],
  community: [
    [/\b(social (network|app|media)|community|communauté|forum|réseau social)\b/i, 5],
    [/\b(feed|timeline|posts?|followers?|abonnés?|discussion)\b/i, 2],
  ],
};

/** Detect the most likely archetype for a project idea. */
export function detectArchetype(idea: string): AppArchetype {
  const text = (idea || '').toLowerCase();
  let bestId = DEFAULT_ARCHETYPE.id;
  let bestScore = 0;
  for (const [id, rules] of Object.entries(DETECTION_KEYWORDS)) {
    let score = 0;
    for (const [re, weight] of rules) {
      if (re.test(text)) score += weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  // Require a minimum signal; otherwise fall back to the generic multi-page site.
  if (bestScore < 2) return DEFAULT_ARCHETYPE;
  return ARCHETYPES[bestId] ?? DEFAULT_ARCHETYPE;
}

/** Does the idea imply user roles / accounts / an admin area? */
export function ideaImpliesAuth(idea: string): boolean {
  return /\b(admin|administrateur|administration|login|log-?in|sign-?up|signup|account|compte|member|membre|role|rôle|dashboard|utilisateur|user account|connexion|inscription|authentif|permission)\b/i.test(
    idea || '',
  );
}

// ── Prompt block ────────────────────────────────────────────────────────────

/**
 * Render the archetype's mandatory-page manifest + guidance as a prompt block
 * injected into buildBuildSpecPrompt.
 */
/**
 * The back-office spec, injected whenever the idea implies an admin area.
 *
 * Two failures made generated admin panels unusable, and both trace back to
 * this prompt rather than to the model:
 *   1. Section 4 demands one shell "uniform across every page", so /admin
 *      inherited the marketing header, footer and hero chrome and looked like
 *      a second storefront.
 *   2. The per-archetype manifest gave admin ONE line ("stats dashboard,
 *      product CRUD table, orders list") against five customer pages, so the
 *      back office was thin by construction.
 *
 * The public site is the showpiece; the admin is a tool. Plain, dense and
 * complete beats decorated.
 */
export const ADMIN_PANEL_MANIFEST = [
  'ADMIN PANEL DETECTED — the back office is a SEPARATE SURFACE, not more pages in the public site. Plan it explicitly:',
  'ADMIN SHELL (mandatory, and the single most important rule here): every /admin/* route renders inside its own `AdminLayout` — a fixed left sidebar (links to the dashboard, one entry per managed entity, and Settings), plus a compact top bar showing the signed-in admin, a "View site" link back to /, and sign out. The PUBLIC header, footer, hero sections and marketing chrome MUST NOT appear on any admin route, and the public layout must never wrap them. Admin is full-width, not the marketing container width.',
  'ADMIN VISUAL LANGUAGE: neutral and utilitarian. Neutral grey/near-white surfaces, compact spacing, small type, real tables. The brand palette appears ONLY on primary buttons, links and status badges — no gradients, no hero imagery, no marketing copy. It must be obvious within one second that this is a back office and not the storefront.',
  'ADMIN ROUTES (plan each as its own section-5 subsection, for EVERY entity the app stores):',
  '  - /admin — dashboard: a row of StatCards with real counts (total products, orders, users…) and a recent-activity list. Keep it simple; it is a landing pad, not an analytics suite.',
  '  - /admin/<entity> — list: a Table with search, sortable columns, pagination, and per-row Edit/Delete actions. Never a card grid.',
  '  - /admin/<entity>/new — create form carrying EVERY field marked `user` in that entity\'s field table.',
  '  - /admin/<entity>/:id/edit — edit form with the same fields, plus Delete behind a confirm modal.',
  '  - /admin/settings — site settings (below).',
  'Every entity the app stores gets that full set — products, orders, categories, posts, bookings, users. An entity a visitor can see but the admin cannot edit is an incomplete app.',
  'SITE SETTINGS (/admin/settings, grouped into tabs or sections) — these are REAL data that the PUBLIC site reads, not decoration:',
  '  - Contact: phone, email, address, opening hours → rendered by the public footer and contact page.',
  '  - Branding: site name, tagline, logo URL → rendered in the header, footer and page titles.',
  '  - Social links: Instagram, Facebook, X, LinkedIn, WhatsApp → rendered as footer icons; hide any link left empty.',
  '  - Business rules: currency, tax or commission rate, shipping fee, maintenance mode. Only include the ones this product actually uses, and make the public site genuinely honour each one you include.',
  '  - Legal pages: a plain textarea editor (markdown or paragraphs) for Privacy Policy and Terms & Conditions, each with its own public route (/privacy and /terms) that renders the saved content and is linked from the footer. Seed both with sensible, complete starter copy for this product — never an empty page or a "coming soon" stub.',
  'SETTINGS STORAGE: when the app has a database, settings live in a single-row `site_settings` table read by the public pages — NOT localStorage, which would only ever change what that one admin sees in their own browser while every visitor still saw the old value. Only a mock-data app (no database) may fall back to localStorage.',
  'ADMIN ACCESS: admins sign in through the SAME /login as everyone else and are redirected to /admin on success, while customers go to the home page. Do not build a separate admin login, and never build an admin signup.',
].join('\n');

export function buildArchetypeManifestBlock(
  archetype: AppArchetype,
  impliesAuth: boolean,
): string {
  const lines: string[] = [
    `APP ARCHETYPE: ${archetype.label} (auto-detected from the request).`,
    `A "${archetype.label}" is only COMPLETE when the plan includes AT MINIMUM these screens. Plan every one as a full subsection in section 5 (Pages), each with its own route, layout, mock data, and interactions:`,
  ];
  for (const page of archetype.pages) {
    lines.push(`- ${page.label}`);
  }
  lines.push(
    `Aim for at least ${archetype.minPages} distinct routes — more if the request implies them. Never collapse this manifest into fewer pages.`,
  );
  for (const g of archetype.guidance) lines.push(`- ${g}`);

  // The back office is spelled out separately from the customer manifest: it
  // is a different surface with its own shell, not more public pages.
  if (archetype.pages.some((p) => p.key === 'admin') || impliesAuth) {
    lines.push('', ADMIN_PANEL_MANIFEST);
  }

  if (impliesAuth) {
    lines.push(
      'ROLES DETECTED: plan a mock auth system — an AuthContext, /login and /signup pages, role-guarded routes (redirect to /login when unauthenticated), demo credentials shown on the login card (e.g. admin@demo / client@demo), and the session persisted to localStorage.',
    );
  }
  return lines.join('\n');
}

// ── Lint ────────────────────────────────────────────────────────────────────

export interface PlanLintResult {
  ok: boolean;
  archetypeId: string;
  routeCount: number;
  minPages: number;
  /** Mandatory pages with no supporting evidence in the brief. */
  missingPages: ArchetypePage[];
  /** True when auth was implied but no login/signup evidence exists. */
  missingAuth: boolean;
  /**
   * Entities whose create/edit form field list does not cover the `user`
   * fields their own section-6 table declares — the plan-level form of the
   * "Add car form collects 3 of the card's 6 fields" failure.
   */
  entityViolations: EntityContractViolation[];
}

/** Count distinct route-like paths in a brief (routing table + Route bullets). */
export function countPlanRoutes(brief: string): number {
  const routes = new Set<string>();
  // `/`, `/foo`, `/foo/:id`, `/admin/products/new` — lowercase-led paths.
  const re = /(^|[\s|>"'`(])(\/(?:[a-z0-9:_-]+(?:\/[a-z0-9:_-]+)*)?)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(brief)) !== null) {
    const path = m[2];
    // Skip obvious non-routes (file paths, protocol-relative, image params).
    if (/\.(tsx?|css|html|json|png|jpe?g|svg|webp)$/i.test(path)) continue;
    if (path.startsWith('/src') || path.startsWith('//')) continue;
    routes.add(path);
  }
  return routes.size;
}

/**
 * Verify a produced brief actually covers its archetype's manifest before the
 * plan becomes a binding contract. Heuristic and lenient — designed to catch
 * gross omissions (no cart, no auth, half the pages), not wording.
 */
export function lintPlanAgainstArchetype(
  brief: string,
  archetype: AppArchetype,
  impliesAuth: boolean,
): PlanLintResult {
  const text = brief || '';
  const missingPages = archetype.pages.filter(
    (page) => !page.patterns.some((re) => re.test(text)),
  );
  const routeCount = countPlanRoutes(text);
  const missingAuth =
    impliesAuth &&
    !AUTH_LOGIN.patterns.some((re) => re.test(text)) &&
    !AUTH_SIGNUP.patterns.some((re) => re.test(text));
  const entityViolations = lintPlanEntityContracts(text);
  const ok =
    missingPages.length === 0 &&
    routeCount >= archetype.minPages &&
    !missingAuth &&
    entityViolations.length === 0;
  return {
    ok,
    archetypeId: archetype.id,
    routeCount,
    minPages: archetype.minPages,
    missingPages,
    missingAuth,
    entityViolations,
  };
}

/** Human-readable amendment instruction for the plan-repair LLM call. */
export function formatPlanLintForRepair(result: PlanLintResult): string {
  const lines: string[] = [
    'PLAN COMPLETENESS GATE — your plan is missing mandatory parts for this product type. Amend it (keep everything already good; ADD what is missing) so it satisfies all of the following:',
  ];
  if (result.missingPages.length > 0) {
    lines.push('Add these missing screens (full Pages-section subsections + routing-table rows + file-map entries):');
    for (const p of result.missingPages) lines.push(`  - ${p.label}`);
  }
  if (result.routeCount < result.minPages) {
    lines.push(
      `  - The plan has only ~${result.routeCount} routes; this product type needs at least ${result.minPages}. Add the missing screens rather than padding.`,
    );
  }
  if (result.missingAuth) {
    lines.push(
      '  - Add a mock auth system: AuthContext, /login and /signup pages, role-guarded routes, demo credentials on the login card, session in localStorage.',
    );
  }
  if (result.entityViolations.length > 0) {
    lines.push(
      'Fix these ENTITY FIELD CONTRACT gaps — a create/edit form must collect every field marked `user` in that entity\'s table, or the generated app ships a form that cannot produce the records its own cards display:',
    );
    lines.push(...formatEntityViolationsForRepair(result.entityViolations));
  }
  lines.push(
    'Return the COMPLETE amended plan (all sections 1–10), not a diff. Keep the same JSON response shape.',
  );
  return lines.join('\n');
}
