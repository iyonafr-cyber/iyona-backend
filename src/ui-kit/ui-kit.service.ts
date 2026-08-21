import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  KIT_PATHS,
  KIT_COMPONENT_NAMES,
  KIT_DEPENDENCIES,
  UI_KIT_VERSION,
  DEFAULT_PALETTES,
  DESIGN_STYLES,
  DEFAULT_DESIGN_STYLE_ID,
  type PaletteOverrides,
  type DesignStyle,
} from './ui-kit.constants';

/**
 * Manages the built-in UI kit that ships with every initial generation.
 *
 * On boot, reads the raw .tsx / .ts / .css files from disk and caches them.
 * At generation time, callers use `getInitialFiles()` to get the full file map
 * and `mergeIntoFileMap()` to overlay the kit onto AI-generated output.
 */
@Injectable()
export class UiKitService implements OnModuleInit {
  private readonly logger = new Logger(UiKitService.name);

  /** path-in-generated-project → raw file content (template, not yet themed) */
  private templateCache = new Map<string, string>();

  private static readonly FILES_DIR = path.resolve(__dirname, 'files');

  onModuleInit() {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    for (const kitPath of KIT_PATHS) {
      const stripped = kitPath.replace(/^src\//, '');
      const abs = path.join(UiKitService.FILES_DIR, stripped);
      try {
        this.templateCache.set(kitPath, fs.readFileSync(abs, 'utf-8'));
      } catch (err) {
        this.logger.error(
          `Failed to read UI kit file ${abs}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    this.logger.log(
      `UI kit v${UI_KIT_VERSION} loaded: ${this.templateCache.size}/${KIT_PATHS.length} files`,
    );
  }

  /**
   * Return the full kit file map with color tokens resolved.
   * Pass palette overrides from the project/user prompt; missing keys
   * fall back to DEFAULT_PALETTES.
   */
  getInitialFiles(
    palettes?: PaletteOverrides,
    style?: DesignStyle,
  ): Record<string, string> {
    const primary = {
      ...DEFAULT_PALETTES.primary,
      ...(palettes?.primary ?? {}),
    };
    const secondary = {
      ...DEFAULT_PALETTES.secondary,
      ...(palettes?.secondary ?? {}),
    };
    const accent = { ...DEFAULT_PALETTES.accent, ...(palettes?.accent ?? {}) };
    const designStyle = style ?? DESIGN_STYLES[DEFAULT_DESIGN_STYLE_ID];

    const out: Record<string, string> = {};
    for (const [kitPath, template] of this.templateCache.entries()) {
      let content = template;
      if (kitPath.endsWith('.css')) {
        content = this.resolveColorTokens(content, primary, secondary, accent);
        content = this.resolveStyleTokens(content, designStyle);
      }
      out[kitPath] = content;
    }
    return out;
  }

  private resolveColorTokens(
    css: string,
    primary: Record<string, string>,
    secondary: Record<string, string>,
    accent: Record<string, string>,
  ): string {
    let out = css;
    for (const [shade, hex] of Object.entries(primary)) {
      out = out.replaceAll(`{{PRIMARY_${shade}}}`, hex);
    }
    for (const [shade, hex] of Object.entries(secondary)) {
      out = out.replaceAll(`{{SECONDARY_${shade}}}`, hex);
    }
    for (const [shade, hex] of Object.entries(accent)) {
      out = out.replaceAll(`{{ACCENT_${shade}}}`, hex);
    }
    return out;
  }

  /**
   * Substitute the design-style tokens (surface ramp, radius, shadow, font,
   * heading) that make sites structurally distinct beyond color. Mirrors
   * resolveColorTokens — same {{TOKEN}} placeholder mechanism in ui-kit.css.
   */
  private resolveStyleTokens(css: string, style: DesignStyle): string {
    let out = css;
    for (const [shade, hex] of Object.entries(style.surface)) {
      out = out.replaceAll(`{{SURFACE_${shade}}}`, hex);
    }
    out = out
      .replaceAll('{{RADIUS_SM}}', style.radius.sm)
      .replaceAll('{{RADIUS_MD}}', style.radius.md)
      .replaceAll('{{RADIUS_LG}}', style.radius.lg)
      .replaceAll('{{RADIUS_XL}}', style.radius.xl)
      .replaceAll('{{SHADOW_SM}}', style.shadow.sm)
      .replaceAll('{{SHADOW_MD}}', style.shadow.md)
      .replaceAll('{{SHADOW_LG}}', style.shadow.lg)
      .replaceAll('{{SHADOW_XL}}', style.shadow.xl)
      .replaceAll('{{FONT_SANS}}', style.fontSans)
      .replaceAll('{{FONT_DISPLAY}}', style.fontDisplay)
      .replaceAll('{{HEAD_WEIGHT}}', style.heading.weight)
      .replaceAll('{{HEAD_TRACKING}}', style.heading.tracking)
      .replaceAll('{{HEAD_LINE}}', style.heading.line);
    return out;
  }

  /**
   * Overlay kit files onto an AI-generated file map. Kit always wins on
   * path collision. Returns the count of collisions detected (for logging).
   */
  mergeIntoFileMap(
    files: Record<string, string>,
    palettes?: PaletteOverrides,
    style?: DesignStyle,
  ): { merged: Record<string, string>; collisions: string[] } {
    const kitFiles = this.getInitialFiles(palettes, style);
    const collisions: string[] = [];
    const merged = { ...files };

    for (const [kitPath, content] of Object.entries(kitFiles)) {
      if (kitPath in files) collisions.push(kitPath);
      merged[kitPath] = content;
    }

    return { merged, collisions };
  }

  /**
   * Enforce mutate-mode lock: restore kit files from canonical source,
   * overwriting any changes the AI made AND re-adding any that went missing.
   * This guarantees kit integrity across every revision.
   */
  enforceKitLock(
    files: Record<string, string>,
    palettes?: PaletteOverrides,
    style?: DesignStyle,
  ): Record<string, string> {
    const kitFiles = this.getInitialFiles(palettes, style);
    const out = { ...files };
    for (const [kitPath, content] of Object.entries(kitFiles)) {
      out[kitPath] = content; // Overwrite or add — kit is always present
    }
    return out;
  }

  /**
   * Returns the compact API summary injected into the generation preamble.
   * Lists each primitive with its props so the AI knows what to import.
   */
  getApiSummary(): string {
    return [
      'BUILT-IN UI KIT (src/components/ui/)',
      '',
      'These files are pre-installed. DO NOT emit FILE blocks for any path under',
      'src/components/ui/ or src/lib/cn.ts or src/styles/ui-kit.css.',
      'Import from "@/components/ui" or individual files. Use these instead of defining your own',
      'Button, Card, Input, Textarea, Select, Checkbox, Label, Badge, Modal, Table, EmptyState, Skeleton, or Toast.',
      '',
      'REQUIRED package.json dependencies (the kit imports these — a clean Vercel',
      'install fails without them). These are ALREADY part of the app and are',
      'EXEMPT from any "install only the listed packages" rule; make sure',
      'package.json declares every one at these versions:',
      ...Object.entries(KIT_DEPENDENCIES).map(
        ([name, range]) => `  "${name}": "${range}"`,
      ),
      '',
      'Helper:',
      '  @/lib/cn — cn(...classes) — clsx + tailwind-merge utility',
      '',
      'Primitives:',
      '',
      '  Button — variant: "primary"|"secondary"|"outline"|"ghost"|"danger", size: "sm"|"md"|"lg"|"icon", loading?: boolean',
      '  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter — noPadding?: boolean on Card',
      '  Input — label?: string, error?: string, hint?: string (plus all HTMLInputElement props)',
      '  Textarea — label?: string, error?: string, hint?: string, rows? (plus all HTMLTextAreaElement props)',
      '  Select — label?: string, error?: string, hint?: string; pass <option>s as children (plus HTMLSelectElement props)',
      '  Checkbox — label?: string (plus HTMLInputElement props, minus type); renders wrapped in a <label> when label is set',
      '  Label — required?: boolean (plus all HTMLLabelElement props)',
      '  Badge — variant: "default"|"primary"|"success"|"warning"|"error"|"outline"',
      '  Modal — open: boolean, onClose: () => void, title?: string, description?: string, size: "sm"|"md"|"lg"|"xl"',
      '  Table, TableHeader, TableBody, TableRow, TableHead, TableCell — unstyled pass-through with hover rows',
      '  EmptyState — icon?: ReactNode, title: string, description?: string, action?: ReactNode',
      '  Skeleton, SkeletonText — circle?: boolean on Skeleton, lines?: number on SkeletonText',
      '  toast.success/error/info/warning(msg) — wrapper over react-toastify (its CSS is already',
      '    imported inside the kit; do NOT import it again). You MUST render <ToastContainer /> exactly',
      '    once at the app root (App.tsx) or toasts will not appear. Import both from "@/components/ui".',
      '',
      'Composition components (import from "@/components/ui" — use these to make pages feel',
      'finished; reserve Table for admin/data-dense views, and use these for everything else):',
      '  Tabs, TabsList, TabsTrigger, TabsContent — controlled: <Tabs value onValueChange>',
      '  Accordion, AccordionItem — <Accordion type="single"|"multiple">; <AccordionItem value title>…</AccordionItem>. Ideal for FAQs.',
      '  Breadcrumbs — items: {label, href?}[]; last item is the current page',
      '  Pagination — page, totalPages, onPageChange (auto-hides at ≤1 page, ellipses for long ranges)',
      '  Avatar — src?, name (initials fallback), size: "sm"|"md"|"lg"|"xl"',
      '  StatCard — label, value, icon?, change?, trend?: "up"|"down" (dashboard metric tile)',
      '  RatingStars — value, max?, onChange? (interactive when passed), count? (review count)',
      '  QuantityStepper — value, onChange, min?, max? (cart quantity control)',
      '  Drawer — open, onClose, side?: "right"|"left", title? (cart slide-over / mobile nav / filters)',
      '',
      'Motion & scroll helpers (all reduced-motion-safe; import from "@/components/ui"):',
      '  SmoothScroll — Lenis momentum scrolling. Mount ONCE at the shell root, wrapping the router outlet.',
      '  PageTransition — wrap each routed page for a fade/rise enter (300ms, ease-out).',
      '  Stagger + StaggerItem — reveal list children one-by-one (~50ms apart).',
      '  Prefer these over hand-rolling Motion so behavior + reduced-motion handling stay consistent.',
      '',
      'Dark mode: all kit primitives ship light + dark styles and follow the OS theme',
      "automatically (Tailwind's `dark:` = prefers-color-scheme). For YOUR OWN markup,",
      'pair every light surface/text class with a `dark:` counterpart (e.g. `bg-white',
      'dark:bg-surface-900`, `text-surface-900 dark:text-surface-50`) so pages match the kit.',
      '',
      'Design tokens: @/styles/ui-kit.css owns the @theme block (primary/secondary/accent/surface palettes,',
      'radius, shadows). Use `bg-primary-600`, `text-surface-700`, `rounded-[var(--radius-md)]`, etc.',
      'Do NOT redefine a @theme block in src/index.css — import ui-kit.css instead:',
      "  @import './styles/ui-kit.css';",
      "  @import 'tailwindcss';",
      '',
      'Typography: the kit sets the GLOBAL font via --font-sans / --font-display (a',
      'project-specific system-font stack — the design style is chosen per project) plus',
      'refined heading weight/tracking/line-height. Do NOT set a font-family in index.css',
      'and do NOT import a webfont — the kit already owns typography. Just add',
      '`@import "./styles/ui-kit.css";` then `@import "tailwindcss";`. Pick heading SIZES',
      'per design; the font family + polish come from the kit tokens.',
      '',
      'Attractive backgrounds (on-brand gradient utilities — use for heroes & CTA bands so',
      'sections have real depth, never a flat colour; the page body stays neutral):',
      '  .bg-gradient-mesh   — soft multi-point hero mesh (great behind a hero headline)',
      '  .bg-gradient-brand  — bold primary→accent diagonal (CTA / feature bands)',
      '  .bg-gradient-subtle — barely-there section tint',
      '  .text-gradient      — primary→accent clipped headline text',
    ].join('\n');
  }

  get version(): number {
    return UI_KIT_VERSION;
  }

  get kitPaths(): readonly string[] {
    return KIT_PATHS;
  }

  /** Every component importable from `@/components/ui` (primitives + compositions + motion). */
  get primitiveNames(): readonly string[] {
    return KIT_COMPONENT_NAMES;
  }
}
