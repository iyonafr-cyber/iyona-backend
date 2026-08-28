import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** The closing conversion band every page ends with. */
export type CTABandVariant = 'bordered' | 'split' | 'centered' | 'dark-inverted';

export interface CTABandProps {
  variant?: CTABandVariant;
  eyebrow?: string;
  title: string;
  copy?: string;
  /** Pass your router Link / Button so the CTA routes correctly. */
  action?: ReactNode;
  className?: string;
}

const T =
  'font-[family-name:var(--font-display)] font-bold tracking-[-0.025em]';

export function CTABand({
  variant = 'bordered',
  eyebrow,
  title,
  copy,
  action,
  className,
}: CTABandProps) {
  const eyebrowCls =
    'text-[11px] font-bold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-400';

  if (variant === 'dark-inverted') {
    return (
      <section className={cn('bg-primary-900 px-6 py-16 dark:bg-surface-900', className)}>
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
          {eyebrow && (
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-400">
              {eyebrow}
            </p>
          )}
          <h2 className={cn(T, 'text-3xl text-white md:text-4xl')}>{title}</h2>
          {copy && <p className="max-w-xl text-white/70">{copy}</p>}
          {action}
        </div>
      </section>
    );
  }

  if (variant === 'centered') {
    return (
      <section className={cn('px-6 py-16', className)}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          {eyebrow && <p className={eyebrowCls}>{eyebrow}</p>}
          <h2 className={cn(T, 'text-3xl text-surface-900 md:text-4xl dark:text-surface-50')}>
            {title}
          </h2>
          {copy && <p className="text-surface-600 dark:text-surface-300">{copy}</p>}
          {action}
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section className={cn('px-6 py-16', className)}>
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-[var(--radius-lg)] bg-surface-100 p-10 md:flex-row md:items-center dark:bg-surface-900">
          <div>
            {eyebrow && <p className={eyebrowCls}>{eyebrow}</p>}
            <h2 className={cn(T, 'mt-2 text-2xl text-surface-900 md:text-3xl dark:text-surface-50')}>
              {title}
            </h2>
            {copy && (
              <p className="mt-2 max-w-xl text-surface-600 dark:text-surface-300">
                {copy}
              </p>
            )}
          </div>
          <div className="shrink-0">{action}</div>
        </div>
      </section>
    );
  }

  return (
    <section className={cn('px-6 py-16', className)}>
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 border border-surface-300 p-10 md:flex-row md:items-center dark:border-surface-700">
        <div>
          {eyebrow && <p className={eyebrowCls}>{eyebrow}</p>}
          <h2 className={cn(T, 'mt-2 text-2xl text-surface-900 md:text-3xl dark:text-surface-50')}>
            {title}
          </h2>
          {copy && (
            <p className="mt-2 max-w-xl text-surface-600 dark:text-surface-300">
              {copy}
            </p>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </section>
  );
}

export default CTABand;
