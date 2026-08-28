import { cn } from '@/lib/cn';

/** Eyebrow + title + supporting copy. Every section on every page opens with
 *  one of these, so its alignment is a large part of a site's rhythm. */
export type SectionHeadingVariant = 'left' | 'centered' | 'inline-rule';

export interface SectionHeadingProps {
  variant?: SectionHeadingVariant;
  eyebrow?: string;
  title: string;
  copy?: string;
  className?: string;
}

const EYEBROW =
  'text-[11px] font-bold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-400';
const TITLE =
  'font-[family-name:var(--font-display)] font-bold tracking-[-0.025em] text-surface-900 dark:text-surface-50';

export function SectionHeading({
  variant = 'left',
  eyebrow,
  title,
  copy,
  className,
}: SectionHeadingProps) {
  if (variant === 'centered') {
    return (
      <div className={cn('mx-auto max-w-2xl text-center', className)}>
        {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
        <h2 className={cn(TITLE, 'mt-3 text-3xl md:text-4xl')}>{title}</h2>
        {copy && (
          <p className="mt-4 text-surface-600 dark:text-surface-300">{copy}</p>
        )}
      </div>
    );
  }

  if (variant === 'inline-rule') {
    return (
      <div
        className={cn(
          'flex flex-col gap-4 border-b border-surface-200 pb-6 md:flex-row md:items-end md:justify-between dark:border-surface-800',
          className,
        )}
      >
        <div>
          {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
          <h2 className={cn(TITLE, 'mt-2 text-3xl md:text-4xl')}>{title}</h2>
        </div>
        {copy && (
          <p className="max-w-md text-sm text-surface-600 dark:text-surface-300">
            {copy}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('max-w-2xl', className)}>
      {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
      <h2 className={cn(TITLE, 'mt-3 text-3xl md:text-4xl')}>{title}</h2>
      {copy && (
        <p className="mt-4 text-surface-600 dark:text-surface-300">{copy}</p>
      )}
    </div>
  );
}

export default SectionHeading;
