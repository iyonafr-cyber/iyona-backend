/**
 * Prompt fragments describing the locked UI kit and the pinned dependency set.
 *
 * WHY THIS EXISTS: these facts used to be hand-copied into five separate agent
 * prompts (full build, cleanup, update-cleanup, repair, chat) plus the LLM plan
 * prompt. They drifted — the cleanup/chat prompts still advertised 8 primitives
 * long after the kit grew to 26 components, so repair rounds hand-rolled
 * Accordions the kit already shipped. Everything here derives from
 * {@link ui-kit.constants}, which is also what actually gets seeded into the
 * repo, so the prompts can no longer disagree with the code.
 */
import {
  KIT_PRIMITIVE_NAMES,
  KIT_COMPOSITION_NAMES,
  KIT_MOTION_NAMES,
  KIT_DEPENDENCIES,
  SCAFFOLD_DEPENDENCIES,
} from './ui-kit.constants';

const primitives = KIT_PRIMITIVE_NAMES.join(', ').replace('Toast', 'toast');
const compositions = KIT_COMPOSITION_NAMES.join(', ');
const motion = KIT_MOTION_NAMES.join(', ');

/** Full inventory sentence — what may be imported and must never be redefined. */
export const KIT_INVENTORY = [
  `Import from "@/components/ui" — primitives: ${primitives}/ToastContainer; compositions: ${compositions}; motion: ${motion}.`,
  'NEVER define your own version of any of these. Read src/components/ui/index.ts for the exact exports.',
  'Use cn() from "@/lib/cn" for class merging and the @theme design tokens from src/styles/ui-kit.css.',
].join('\n');

/** The locked-files rule. Paired with {@link KIT_INVENTORY} in every prompt. */
export const KIT_LOCKED_RULE =
  'UI KIT (LOCKED): Files under src/components/ui/, src/lib/cn.ts, and src/styles/ui-kit.css are the design system — NEVER modify, delete, or overwrite them.';

/** Reach-for guidance so pages feel finished instead of card-soup. */
export const KIT_USAGE_HINT =
  'Reach for the compositions to make pages feel finished — Accordion for FAQs, RatingStars for reviews, QuantityStepper + Drawer for carts, StatCard for dashboards, Breadcrumbs + Pagination for list pages — instead of rendering everything as plain cards. Reserve Table for admin/data-dense surfaces. Use the kit motion components (PageTransition for route changes, Stagger/StaggerItem for list reveals, SmoothScroll at the app root) rather than hand-rolling transitions, so motion is consistent across every screen.';

const fmt = (deps: Record<string, string>): string =>
  Object.entries(deps)
    .map(([name, range]) => `"${name}": "${range}"`)
    .join(', ');

/** Build-critical scaffold pins. One source; previously copy-pasted five times. */
export const VERSION_PINS_LINE = `CRITICAL version pins (do not change): ${fmt(
  SCAFFOLD_DEPENDENCIES,
)}.`;

/** Packages the locked kit imports — absent from package.json = failed clean install. */
export const KIT_DEPENDENCIES_LINE = `UI KIT DEPENDENCIES (imported by the locked kit — a clean install fails on "Cannot find module" without them): ${fmt(
  KIT_DEPENDENCIES,
)}.`;
