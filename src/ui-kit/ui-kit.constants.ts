/**
 * Paths (relative to generated project root) that belong to the UI kit.
 * Used for injection, collision detection, and mutate-mode lock.
 */
export const KIT_PATHS = [
  'src/lib/cn.ts',
  'src/styles/ui-kit.css',
  'src/components/ui/Button.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/Input.tsx',
  'src/components/ui/Textarea.tsx',
  'src/components/ui/Select.tsx',
  'src/components/ui/Checkbox.tsx',
  'src/components/ui/Label.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/Modal.tsx',
  'src/components/ui/Table.tsx',
  'src/components/ui/EmptyState.tsx',
  'src/components/ui/Skeleton.tsx',
  'src/components/ui/Toast.tsx',
  'src/components/ui/SmoothScroll.tsx',
  'src/components/ui/PageTransition.tsx',
  'src/components/ui/Stagger.tsx',
  'src/components/ui/Tabs.tsx',
  'src/components/ui/Accordion.tsx',
  'src/components/ui/Breadcrumbs.tsx',
  'src/components/ui/Pagination.tsx',
  'src/components/ui/Avatar.tsx',
  'src/components/ui/StatCard.tsx',
  'src/components/ui/RatingStars.tsx',
  'src/components/ui/QuantityStepper.tsx',
  'src/components/ui/Drawer.tsx',
  'src/components/ui/index.ts',
] as const;

/**
 * Form + display primitives exported from `@/components/ui`.
 * The agent must NEVER redefine these.
 */
export const KIT_PRIMITIVE_NAMES = [
  'Button',
  'Card',
  'Input',
  'Textarea',
  'Select',
  'Checkbox',
  'Label',
  'Badge',
  'Modal',
  'Table',
  'EmptyState',
  'Skeleton',
  'Toast',
] as const;

/**
 * Higher-level compositions. These exist so pages feel finished (FAQs, reviews,
 * carts, dashboards, list pages) instead of being rendered as plain cards.
 */
export const KIT_COMPOSITION_NAMES = [
  'Tabs',
  'Accordion',
  'Breadcrumbs',
  'Pagination',
  'Avatar',
  'StatCard',
  'RatingStars',
  'QuantityStepper',
  'Drawer',
] as const;

/**
 * Motion helpers the kit already ships (backed by motion/react + lenis). The
 * plan must reference these rather than prescribing hand-rolled transitions —
 * otherwise every generated app animates differently.
 */
export const KIT_MOTION_NAMES = [
  'PageTransition',
  'Stagger',
  'StaggerItem',
  'SmoothScroll',
] as const;

/** Everything importable from `@/components/ui` — the locked surface. */
export const KIT_COMPONENT_NAMES = [
  ...KIT_PRIMITIVE_NAMES,
  ...KIT_COMPOSITION_NAMES,
  ...KIT_MOTION_NAMES,
] as const;

export const UI_KIT_VERSION = 3;

/**
 * Packages the UI kit itself imports. These are NOT optional and NOT subject to
 * the plan's "install only the listed packages" rule — the seeded kit files
 * (Toast.tsx, Modal.tsx, cn.ts, ...) import them directly, so a clean Vercel
 * install fails at build time unless every one of these is in package.json.
 * Single source of truth: surfaced to the agent via UiKitService.getApiSummary()
 * and mirrored in the Cursor build prompts. Pin ranges are ERESOLVE-safe against
 * React 18 + Tailwind v4.
 */
export const KIT_DEPENDENCIES: Record<string, string> = {
  clsx: '^2.1.1',
  'tailwind-merge': '^3.0.0',
  'lucide-react': '^0.469.0',
  'react-toastify': '^10.0.6',
  // Motion + smooth-scroll helpers (PageTransition, Stagger, SmoothScroll) import
  // these, so they must resolve at type-check/build time even if a given app
  // doesn't use them. motion is usually already in the plan; lenis powers
  // SmoothScroll.
  motion: '^11.15.0',
  lenis: '^1.1.14',
} as const;

/**
 * Build-critical pins for the seeded Vite scaffold. These are stated to the
 * Cursor agent in every prompt that can touch package.json, because the classic
 * failure is an agent "helpfully" bumping React or TypeScript and producing
 * TS1005 parser errors or an ERESOLVE peer conflict on a clean Vercel install.
 * Single source of truth — the prompts render this map, they do not restate it.
 */
export const SCAFFOLD_DEPENDENCIES: Record<string, string> = {
  typescript: '~5.7.3',
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  '@types/react': '^18.3.18',
  '@types/react-dom': '^18.3.5',
  vite: '^6.0.7',
  tailwindcss: '^4.0.0',
  '@tailwindcss/vite': '^4.0.0',
  'react-router': '^7.1.1',
  motion: '^11.15.0',
} as const;

/**
 * Default color palettes used when the project prompt doesn't specify colors.
 * Each shade maps to a Tailwind-style numeric scale.
 */
export const DEFAULT_PALETTES = {
  primary: {
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
    400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
    800: '#1e40af', 900: '#1e3a8a', 950: '#172554',
  },
  secondary: {
    50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
    400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
    800: '#1e293b', 900: '#0f172a', 950: '#020617',
  },
  accent: {
    50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc',
    400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf',
    800: '#86198f', 900: '#701a75', 950: '#4a044e',
  },
} as const;

export type PaletteOverrides = {
  primary?: Record<string, string>;
  secondary?: Record<string, string>;
  accent?: Record<string, string>;
};

/* ────────────────────────────────────────────────────────────────────────
 * Design styles
 *
 * Historically EVERY generated site shared one hardcoded look (Apple SF Pro
 * font, one radius scale, one shadow set, one neutral-gray surface ramp) and
 * only the 3 brand colors varied — which is why every build came out
 * structurally identical. A "design style" lets the NON-color visual language
 * (typography, corner radius, elevation, neutral surface tint, heading weight)
 * vary per project too.
 *
 * All font stacks are OS/system fonts — no webfont download, no extra build
 * dependency, so introducing them cannot break a generated app's build.
 * Substituted into ui-kit.css at seed time exactly like the color tokens.
 * ──────────────────────────────────────────────────────────────────────── */

/** Neutral surface ramps. Same structure as a palette; low-saturation. */
const SURFACE_NEUTRAL: Record<string, string> = {
  50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4',
  400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040',
  800: '#262626', 900: '#171717', 950: '#0a0a0a',
};
const SURFACE_WARM: Record<string, string> = {
  50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1',
  400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c',
  800: '#292524', 900: '#1c1917', 950: '#0c0a09',
};
const SURFACE_COOL: Record<string, string> = {
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
  400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
  800: '#1e293b', 900: '#0f172a', 950: '#020617',
};

export interface DesignStyle {
  id: string;
  label: string;
  fontSans: string;
  fontDisplay: string;
  radius: { sm: string; md: string; lg: string; xl: string };
  shadow: { sm: string; md: string; lg: string; xl: string };
  surface: Record<string, string>;
  heading: { weight: string; tracking: string; line: string };
}

// Reusable shadow sets (soft / crisp / elevated).
const SHADOW_SOFT = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
};
const SHADOW_CRISP = {
  sm: '0 1px 1px 0 rgb(0 0 0 / 0.04)',
  md: '0 2px 4px -1px rgb(0 0 0 / 0.08)',
  lg: '0 6px 10px -3px rgb(0 0 0 / 0.1)',
  xl: '0 12px 18px -6px rgb(0 0 0 / 0.12)',
};
const SHADOW_ELEVATED = {
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.08)',
  md: '0 6px 14px -2px rgb(0 0 0 / 0.14), 0 2px 6px -2px rgb(0 0 0 / 0.1)',
  lg: '0 16px 28px -6px rgb(0 0 0 / 0.16), 0 6px 10px -6px rgb(0 0 0 / 0.12)',
  xl: '0 28px 44px -12px rgb(0 0 0 / 0.2), 0 10px 16px -8px rgb(0 0 0 / 0.14)',
};

export const DESIGN_STYLES: Record<string, DesignStyle> = {
  // Today's look — kept as the default so nothing regresses.
  apple: {
    id: 'apple',
    label: 'Apple / Minimal',
    fontSans:
      '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    fontDisplay:
      '"SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Helvetica, Arial, sans-serif',
    radius: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' },
    shadow: SHADOW_SOFT,
    surface: SURFACE_NEUTRAL,
    heading: { weight: '600', tracking: '-0.021em', line: '1.08' },
  },
  // Serif headings, warm paper surface — magazine / brand feel.
  editorial: {
    id: 'editorial',
    label: 'Editorial / Serif',
    fontSans:
      '"Seravek", "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", "Segoe UI", system-ui, sans-serif',
    fontDisplay:
      '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, Cambria, "Times New Roman", serif',
    radius: { sm: '0.125rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem' },
    shadow: SHADOW_CRISP,
    surface: SURFACE_WARM,
    heading: { weight: '600', tracking: '-0.008em', line: '1.16' },
  },
  // Geometric sans, cool surface, generous radius — modern SaaS.
  geometric: {
    id: 'geometric',
    label: 'Geometric / SaaS',
    fontSans:
      '"Avenir Next", Avenir, "Segoe UI", Roboto, system-ui, "Helvetica Neue", Arial, sans-serif',
    fontDisplay:
      '"Avenir Next", Avenir, "Segoe UI", Roboto, system-ui, "Helvetica Neue", Arial, sans-serif',
    radius: { sm: '0.375rem', md: '0.625rem', lg: '0.875rem', xl: '1.25rem' },
    shadow: SHADOW_ELEVATED,
    surface: SURFACE_COOL,
    heading: { weight: '700', tracking: '-0.02em', line: '1.1' },
  },
  // Soft, friendly, pill-ish corners — consumer / lifestyle.
  rounded: {
    id: 'rounded',
    label: 'Rounded / Friendly',
    fontSans:
      '"Trebuchet MS", "Segoe UI", system-ui, "Helvetica Neue", Verdana, Arial, sans-serif',
    fontDisplay:
      '"Trebuchet MS", "Segoe UI", system-ui, "Helvetica Neue", Verdana, Arial, sans-serif',
    radius: { sm: '0.5rem', md: '0.875rem', lg: '1.25rem', xl: '1.75rem' },
    shadow: SHADOW_SOFT,
    surface: SURFACE_WARM,
    heading: { weight: '800', tracking: '-0.015em', line: '1.12' },
  },
  // Sharp corners, crisp elevation, neutral grays — corporate / trust.
  corporate: {
    id: 'corporate',
    label: 'Corporate / Sharp',
    fontSans:
      '"Segoe UI", Roboto, "Helvetica Neue", system-ui, Arial, sans-serif',
    fontDisplay:
      '"Segoe UI", Roboto, "Helvetica Neue", system-ui, Arial, sans-serif',
    radius: { sm: '0.125rem', md: '0.25rem', lg: '0.375rem', xl: '0.5rem' },
    shadow: SHADOW_CRISP,
    surface: SURFACE_NEUTRAL,
    heading: { weight: '700', tracking: '-0.005em', line: '1.15' },
  },
};

export const DEFAULT_DESIGN_STYLE_ID = 'apple';

/**
 * Deterministically pick a design style from a stable seed (the projectId).
 * Same project → same style across the initial build, every revision, and
 * every redeploy; different projects fan out across the style set. No storage
 * or schema change required.
 */
export function pickDesignStyle(seed?: string | null): DesignStyle {
  const ids = Object.keys(DESIGN_STYLES);
  if (!seed) return DESIGN_STYLES[DEFAULT_DESIGN_STYLE_ID];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return DESIGN_STYLES[ids[hash % ids.length]];
}

/**
 * Resolve the design style for a project. When the user explicitly picked a
 * valid style in the questionnaire, honor it; otherwise ("auto", unknown, or
 * unset) fall back to the deterministic per-project pick. This keeps the
 * user's override authoritative while preserving auto-variation for everyone
 * who leaves it on Auto (and for every pre-existing project).
 */
export function resolveDesignStyle(
  styleId?: string | null,
  seed?: string | null,
): DesignStyle {
  if (styleId && styleId !== 'auto' && DESIGN_STYLES[styleId]) {
    return DESIGN_STYLES[styleId];
  }
  return pickDesignStyle(seed);
}

/** Lightweight option list for surfacing the picker in the questionnaire UI. */
export const DESIGN_STYLE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'auto', label: 'Auto (recommended)' },
  ...Object.values(DESIGN_STYLES).map((s) => ({ id: s.id, label: s.label })),
];
