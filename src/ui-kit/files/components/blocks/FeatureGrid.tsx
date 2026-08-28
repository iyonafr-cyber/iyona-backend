import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** The "why choose us" / feature section, as four real compositions. */
export type FeatureGridVariant =
  | 'rule-grid'
  | 'cards'
  | 'icon-row'
  | 'alternating';

export interface Feature {
  title: string;
  description: string;
  /** Rendered as-is — pass a lucide icon, an emoji, or nothing. */
  icon?: ReactNode;
  image?: { src: string; alt: string };
}

export interface FeatureGridProps {
  variant?: FeatureGridVariant;
  features: Feature[];
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};
const H = 'font-[family-name:var(--font-display)] font-bold text-surface-900 dark:text-surface-50';
const P = 'text-sm leading-relaxed text-surface-600 dark:text-surface-300';

export function FeatureGrid({
  variant = 'cards',
  features,
  columns = 4,
  className,
}: FeatureGridProps) {
  if (variant === 'rule-grid') {
    return (
      <div
        className={cn(
          'grid grid-cols-1 border-t border-surface-200 dark:border-surface-800',
          COLS[columns],
          className,
        )}
      >
        {features.map((f, i) => (
          <div
            key={f.title}
            className="border-b border-surface-200 p-6 sm:border-r last:sm:border-r-0 dark:border-surface-800"
          >
            <span className="text-[11px] font-bold tracking-[0.16em] text-accent-600 dark:text-accent-400">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className={cn(H, 'mt-3 text-lg')}>{f.title}</h3>
            <p className={cn(P, 'mt-2')}>{f.description}</p>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'icon-row') {
    return (
      <div className={cn('grid grid-cols-1 gap-8', COLS[columns], className)}>
        {features.map((f) => (
          <div key={f.title} className="flex gap-4">
            {f.icon && (
              <span className="mt-0.5 shrink-0 text-accent-600 dark:text-accent-400">
                {f.icon}
              </span>
            )}
            <div>
              <h3 className={cn(H, 'text-base')}>{f.title}</h3>
              <p className={cn(P, 'mt-1.5')}>{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'alternating') {
    return (
      <div className={cn('flex flex-col gap-16', className)}>
        {features.map((f, i) => (
          <div
            key={f.title}
            className={cn(
              'grid items-center gap-8 md:grid-cols-2',
              i % 2 === 1 && 'md:[&>figure]:order-first',
            )}
          >
            <div>
              <h3 className={cn(H, 'text-2xl')}>{f.title}</h3>
              <p className={cn(P, 'mt-3 text-base')}>{f.description}</p>
            </div>
            {f.image && (
              <figure className="aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border border-surface-200 bg-surface-100 dark:border-surface-800 dark:bg-surface-800">
                <img
                  src={f.image.src}
                  alt={f.image.alt}
                  loading="lazy"
                  width={800}
                  height={600}
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                  className="h-full w-full object-cover"
                />
              </figure>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 gap-6', COLS[columns], className)}>
      {features.map((f) => (
        <div
          key={f.title}
          className="rounded-[var(--radius-lg)] border border-surface-200 bg-white p-6 shadow-[var(--shadow-sm)] dark:border-surface-800 dark:bg-surface-900"
        >
          {f.icon && (
            <span className="text-accent-600 dark:text-accent-400">{f.icon}</span>
          )}
          <h3 className={cn(H, 'mt-3 text-lg')}>{f.title}</h3>
          <p className={cn(P, 'mt-2')}>{f.description}</p>
        </div>
      ))}
    </div>
  );
}

export default FeatureGrid;
