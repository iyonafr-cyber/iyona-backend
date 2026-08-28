import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The home hero, as six real compositions instead of a prose description.
 *
 * WHY THIS IS A COMPONENT: the hero used to be mandated in English ("Type-led
 * hero: NO hero photograph, an oversized display headline…") and rebuilt from
 * that text on every project. Prose is a lossy channel for layout, so every
 * site drifted back toward the same full-bleed-photo-with-two-buttons. Here the
 * variant is picked per project and RENDERS — it cannot drift.
 *
 * Every surface, border and corner flows through kit tokens, so a zero-radius
 * project gets square corners here for free.
 */

export type HeroVariant =
  | 'full-bleed'
  | 'split'
  | 'type-led'
  | 'editorial-band'
  | 'mosaic'
  | 'stacked';

export interface HeroAction {
  label: string;
  href: string;
}

export interface HeroStat {
  value: string;
  label: string;
}

export interface HeroProps {
  variant?: HeroVariant;
  /** Small uppercase kicker above the headline. */
  eyebrow?: string;
  headline: string;
  /**
   * One word/phrase inside `headline` to accent. Matched literally; when it is
   * not found the headline renders unchanged rather than breaking.
   */
  accentWord?: string;
  subcopy?: string;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  /** Shown by every variant except `type-led`, which is deliberately imageless. */
  image?: { src: string; alt: string };
  /** Extra images for `mosaic`; ignored by other variants. */
  images?: { src: string; alt: string }[];
  stats?: HeroStat[];
  /** Render prop for the CTAs, so apps can use their router's Link. */
  renderAction?: (action: HeroAction, kind: 'primary' | 'secondary') => ReactNode;
  className?: string;
}

const HEADLINE_BASE =
  'font-[family-name:var(--font-display)] font-bold tracking-[-0.03em] text-surface-900 dark:text-surface-50';

/** Split the headline so the accent word can be wrapped, without regex risk. */
function renderHeadline(headline: string, accentWord?: string) {
  if (!accentWord) return headline;
  const i = headline.indexOf(accentWord);
  if (i === -1) return headline;
  return (
    <>
      {headline.slice(0, i)}
      <span className="text-gradient">{accentWord}</span>
      {headline.slice(i + accentWord.length)}
    </>
  );
}

/**
 * CTAs render as anchors, not the kit Button: a Button is a <button>, and
 * nesting an <a> inside one is invalid HTML. The classes mirror Button's
 * primary/outline look through the same tokens. Apps that need a router Link
 * pass `renderAction`.
 */
const ACTION_BASE =
  'inline-flex h-12 items-center justify-center px-6 text-base font-medium rounded-[var(--radius-md)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
const ACTION_PRIMARY =
  'bg-primary-600 text-white hover:bg-primary-700 ring-offset-white focus-visible:ring-primary-500 dark:ring-offset-surface-950';
const ACTION_SECONDARY =
  'border border-surface-300 text-surface-800 hover:bg-surface-50 ring-offset-white focus-visible:ring-primary-500 dark:border-surface-700 dark:text-surface-100 dark:hover:bg-surface-800 dark:ring-offset-surface-950';
/** On a photographic scrim the neutral tokens vanish, so invert explicitly. */
const ACTION_PRIMARY_ON_DARK =
  'bg-white text-surface-900 hover:bg-surface-100 ring-offset-transparent focus-visible:ring-white';
const ACTION_SECONDARY_ON_DARK =
  'border border-white/60 text-white hover:bg-white/10 ring-offset-transparent focus-visible:ring-white';

function Actions({
  primaryAction,
  secondaryAction,
  renderAction,
  onDark,
  className,
}: Pick<HeroProps, 'primaryAction' | 'secondaryAction' | 'renderAction'> & {
  onDark?: boolean;
  className?: string;
}) {
  if (!primaryAction && !secondaryAction) return null;
  const cls = (kind: 'primary' | 'secondary') =>
    cn(
      ACTION_BASE,
      kind === 'primary'
        ? onDark
          ? ACTION_PRIMARY_ON_DARK
          : ACTION_PRIMARY
        : onDark
          ? ACTION_SECONDARY_ON_DARK
          : ACTION_SECONDARY,
    );
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {primaryAction &&
        (renderAction ? (
          renderAction(primaryAction, 'primary')
        ) : (
          <a href={primaryAction.href} className={cls('primary')}>
            {primaryAction.label}
          </a>
        ))}
      {secondaryAction &&
        (renderAction ? (
          renderAction(secondaryAction, 'secondary')
        ) : (
          <a href={secondaryAction.href} className={cls('secondary')}>
            {secondaryAction.label}
          </a>
        ))}
    </div>
  );
}

function Eyebrow({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-surface-500 dark:text-surface-400">
      {children}
    </p>
  );
}

function Stats({ stats }: { stats?: HeroStat[] }) {
  if (!stats?.length) return null;
  return (
    <dl className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-surface-200 pt-6 dark:border-surface-800">
      {stats.map((s) => (
        <div key={s.label}>
          <dt className="sr-only">{s.label}</dt>
          <dd>
            <span className="block text-2xl font-bold text-surface-900 dark:text-surface-50">
              {s.value}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-surface-500 dark:text-surface-400">
              {s.label}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Images here are decorative-with-alt; a failed load must never show a broken icon. */
function HeroImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      width={1600}
      height={1067}
      onError={(e) => {
        const el = e.currentTarget;
        el.style.visibility = 'hidden';
        el.parentElement?.classList.add('bg-surface-200', 'dark:bg-surface-800');
      }}
      className={cn('h-full w-full object-cover', className)}
    />
  );
}

export function Hero({
  variant = 'full-bleed',
  eyebrow,
  headline,
  accentWord,
  subcopy,
  primaryAction,
  secondaryAction,
  image,
  images,
  stats,
  renderAction,
  className,
}: HeroProps) {
  const title = renderHeadline(headline, accentWord);
  const actions = { primaryAction, secondaryAction, renderAction };

  if (variant === 'type-led') {
    return (
      <section className={cn('px-6 py-24 md:py-32', className)}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1
            className={cn(
              HEADLINE_BASE,
              'mt-6 text-[clamp(2.75rem,9vw,6.5rem)] leading-[0.92]',
            )}
          >
            {title}
          </h1>
          {subcopy && (
            <p className="mt-8 max-w-2xl text-lg text-surface-600 dark:text-surface-300">
              {subcopy}
            </p>
          )}
          <Actions {...actions} className="mt-10" />
          <Stats stats={stats} />
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section className={cn('px-6 py-16 md:py-24', className)}>
        <div className="mx-auto grid max-w-7xl items-center gap-12 md:grid-cols-2">
          <div>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1
              className={cn(
                HEADLINE_BASE,
                'mt-5 text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.02]',
              )}
            >
              {title}
            </h1>
            {subcopy && (
              <p className="mt-6 text-lg text-surface-600 dark:text-surface-300">
                {subcopy}
              </p>
            )}
            <Actions {...actions} className="mt-8" />
            <Stats stats={stats} />
          </div>
          {image && (
            <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border border-surface-200 dark:border-surface-800">
              <HeroImage {...image} />
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'editorial-band') {
    return (
      <section className={className}>
        <div className="mx-auto max-w-7xl px-6 pb-10 pt-20 md:pt-28">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1
            className={cn(
              HEADLINE_BASE,
              'mt-4 max-w-4xl text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.04]',
            )}
          >
            {title}
          </h1>
          {subcopy && (
            <p className="mt-5 max-w-2xl text-lg text-surface-600 dark:text-surface-300">
              {subcopy}
            </p>
          )}
          <Actions {...actions} className="mt-8" />
        </div>
        {image && (
          <figure className="mt-6">
            <div className="h-[45vh] min-h-[320px] w-full overflow-hidden border-y border-surface-200 dark:border-surface-800">
              <HeroImage {...image} />
            </div>
            <figcaption className="mx-auto max-w-7xl px-6 pt-3 text-xs text-surface-500 dark:text-surface-400">
              {image.alt}
            </figcaption>
          </figure>
        )}
        <div className="mx-auto max-w-7xl px-6">
          <Stats stats={stats} />
        </div>
      </section>
    );
  }

  if (variant === 'mosaic') {
    const tiles = (images?.length ? images : image ? [image] : []).slice(0, 3);
    return (
      <section className={cn('px-6 py-16 md:py-24', className)}>
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1
              className={cn(
                HEADLINE_BASE,
                'mt-5 text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.02]',
              )}
            >
              {title}
            </h1>
            {subcopy && (
              <p className="mt-6 text-lg text-surface-600 dark:text-surface-300">
                {subcopy}
              </p>
            )}
            <Actions {...actions} className="mt-8" />
            <Stats stats={stats} />
          </div>
          {tiles.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="row-span-2 aspect-[3/4] overflow-hidden rounded-[var(--radius-lg)] border border-surface-200 dark:border-surface-800">
                <HeroImage {...tiles[0]} />
              </div>
              {tiles.slice(1, 3).map((t) => (
                <div
                  key={t.src}
                  className="aspect-square overflow-hidden rounded-[var(--radius-lg)] border border-surface-200 dark:border-surface-800"
                >
                  <HeroImage {...t} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'stacked') {
    return (
      <section className={cn('px-6 pt-20 md:pt-28', className)}>
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1
            className={cn(
              HEADLINE_BASE,
              'mt-5 text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.02]',
            )}
          >
            {title}
          </h1>
          {subcopy && (
            <p className="mt-6 text-lg text-surface-600 dark:text-surface-300">
              {subcopy}
            </p>
          )}
          <Actions {...actions} className="mt-8 justify-center" />
        </div>
        {image && (
          <div className="mx-auto mt-14 max-w-6xl">
            <div className="aspect-[16/9] overflow-hidden rounded-[var(--radius-xl)] border border-surface-200 shadow-[var(--shadow-lg)] dark:border-surface-800">
              <HeroImage {...image} />
            </div>
          </div>
        )}
      </section>
    );
  }

  // full-bleed
  return (
    <section
      className={cn(
        'relative isolate flex min-h-[70vh] items-end overflow-hidden',
        className,
      )}
    >
      {image && (
        <div className="absolute inset-0 -z-10 bg-surface-200 dark:bg-surface-800">
          <HeroImage {...image} />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/10"
          />
        </div>
      )}
      <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-32">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
          {eyebrow}
        </p>
        <h1
          className={cn(
            'font-[family-name:var(--font-display)] font-bold tracking-[-0.03em] text-white',
            'mt-5 max-w-3xl text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.02]',
          )}
        >
          {headline}
        </h1>
        {subcopy && (
          <p className="mt-6 max-w-xl text-lg text-white/80">{subcopy}</p>
        )}
        <Actions {...actions} onDark className="mt-8" />
      </div>
    </section>
  );
}

export default Hero;
