import { cn } from '@/lib/cn';

/** Social proof, as three real compositions. */
export type TestimonialBandVariant =
  | 'portrait-quotes'
  | 'tinted-band'
  | 'single-large';

export interface Testimonial {
  quote: string;
  name: string;
  role?: string;
  avatar?: { src: string; alt: string };
}

export interface TestimonialBandProps {
  variant?: TestimonialBandVariant;
  testimonials: Testimonial[];
  className?: string;
}

const QUOTE = 'text-surface-700 dark:text-surface-200';
const NAME =
  'font-[family-name:var(--font-display)] font-bold text-surface-900 dark:text-surface-50';

function Avatar({ t, size = 48 }: { t: Testimonial; size?: number }) {
  if (!t.avatar) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-200 text-sm font-bold text-surface-600 dark:bg-surface-700 dark:text-surface-200"
      >
        {t.name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={t.avatar.src}
      alt={t.avatar.alt}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  );
}

export function TestimonialBand({
  variant = 'portrait-quotes',
  testimonials,
  className,
}: TestimonialBandProps) {
  if (!testimonials.length) return null;

  if (variant === 'single-large') {
    const t = testimonials[0];
    return (
      <section className={cn('px-6 py-16', className)}>
        <figure className="mx-auto max-w-3xl text-center">
          <blockquote
            className={cn(
              QUOTE,
              'font-[family-name:var(--font-display)] text-2xl leading-snug md:text-3xl',
            )}
          >
            “{t.quote}”
          </blockquote>
          <figcaption className="mt-8 flex items-center justify-center gap-3">
            <Avatar t={t} />
            <span className="text-left">
              <span className={cn(NAME, 'block text-sm')}>{t.name}</span>
              {t.role && (
                <span className="block text-xs text-surface-500 dark:text-surface-400">
                  {t.role}
                </span>
              )}
            </span>
          </figcaption>
        </figure>
      </section>
    );
  }

  const cards = (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-3">
      {testimonials.slice(0, 3).map((t) => (
        <figure
          key={t.name}
          className={cn(
            'flex h-full flex-col gap-5 p-6',
            variant === 'tinted-band'
              ? 'bg-white/70 dark:bg-surface-900/60'
              : 'rounded-[var(--radius-lg)] border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900',
          )}
        >
          <blockquote className={cn(QUOTE, 'text-sm leading-relaxed')}>
            “{t.quote}”
          </blockquote>
          <figcaption className="mt-auto flex items-center gap-3">
            <Avatar t={t} size={40} />
            <span>
              <span className={cn(NAME, 'block text-sm')}>{t.name}</span>
              {t.role && (
                <span className="block text-xs text-surface-500 dark:text-surface-400">
                  {t.role}
                </span>
              )}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );

  if (variant === 'tinted-band') {
    return (
      <section className={cn('bg-surface-100 px-6 py-16 dark:bg-surface-900/40', className)}>
        {cards}
      </section>
    );
  }
  return <section className={cn('px-6 py-16', className)}>{cards}</section>;
}

export default TestimonialBand;
