import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A grid of products / listings / articles, as three real compositions.
 *
 * WHY: this is the other surface the agent hand-wrote on every build, so every
 * catalogue came out as the same soft card grid regardless of the project's
 * design personality. Corners, borders and surfaces flow through kit tokens, so
 * a zero-radius project gets square tiles without a prompt rule asking for it.
 */

export type ItemGridVariant = 'cards' | 'editorial-bordered' | 'dark-band';

export interface GridItem {
  id: string;
  title: string;
  /** Small uppercase label above the title (category, type, date). */
  eyebrow?: string;
  description?: string;
  /** Rendered as-is, so callers control currency and formatting. */
  meta?: string;
  href?: string;
  image?: { src: string; alt: string };
}

export interface ItemGridProps {
  variant?: ItemGridVariant;
  items: GridItem[];
  columns?: 2 | 3 | 4;
  /** Wrap each tile — e.g. a router Link or a StaggerItem. */
  renderItem?: (item: GridItem, content: ReactNode) => ReactNode;
  /** Shown when `items` is empty; pass the kit EmptyState. */
  emptyState?: ReactNode;
  actionLabel?: string;
  className?: string;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

const EYEBROW =
  'text-[11px] font-bold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-400';

/** Never let a failed load show a broken-image icon. */
function ItemImage({
  src,
  alt,
  ratio,
}: {
  src: string;
  alt: string;
  ratio: string;
}) {
  return (
    <div className={cn('w-full overflow-hidden bg-surface-100 dark:bg-surface-800', ratio)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        width={800}
        height={800}
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
        className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.035]"
      />
    </div>
  );
}

export function ItemGrid({
  variant = 'cards',
  items,
  columns = 3,
  renderItem,
  emptyState,
  actionLabel = 'View details',
  className,
}: ItemGridProps) {
  if (!items.length) return <>{emptyState ?? null}</>;

  const dark = variant === 'dark-band';

  const tile = (item: GridItem) => {
    if (variant === 'editorial-bordered') {
      return (
        <article className="group flex h-full flex-col border border-surface-200 dark:border-surface-800">
          {item.image && <ItemImage {...item.image} ratio="aspect-[4/5]" />}
          <div className="flex flex-1 flex-col gap-2 border-t border-surface-200 p-5 dark:border-surface-800">
            {item.eyebrow && <p className={EYEBROW}>{item.eyebrow}</p>}
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-surface-900 dark:text-surface-50">
              {item.title}
            </h3>
            {item.description && (
              <p className="text-sm leading-relaxed text-surface-600 dark:text-surface-300">
                {item.description}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between pt-4">
              {item.meta && (
                <span className="text-sm font-bold text-surface-900 dark:text-surface-50">
                  {item.meta}
                </span>
              )}
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-accent-600 dark:text-accent-400">
                {actionLabel} &rarr;
              </span>
            </div>
          </div>
        </article>
      );
    }

    if (variant === 'dark-band') {
      return (
        <article className="group flex h-full flex-col border border-white/15 bg-white/5">
          {item.image && <ItemImage {...item.image} ratio="aspect-square" />}
          <div className="flex flex-1 flex-col gap-2 p-5">
            {item.eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-400">
                {item.eyebrow}
              </p>
            )}
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
              {item.title}
            </h3>
            {item.description && (
              <p className="text-sm leading-relaxed text-white/70">
                {item.description}
              </p>
            )}
            {item.meta && (
              <span className="mt-auto pt-4 text-sm font-bold text-white">
                {item.meta}
              </span>
            )}
          </div>
        </article>
      );
    }

    // cards
    return (
      <article className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-surface-200 bg-white shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] dark:border-surface-800 dark:bg-surface-900">
        {item.image && <ItemImage {...item.image} ratio="aspect-[4/3]" />}
        <div className="flex flex-1 flex-col gap-2 p-5">
          {item.eyebrow && <p className={EYEBROW}>{item.eyebrow}</p>}
          <h3 className="text-lg font-semibold leading-tight text-surface-900 dark:text-surface-50">
            {item.title}
          </h3>
          {item.description && (
            <p className="text-sm leading-relaxed text-surface-500 dark:text-surface-400">
              {item.description}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between pt-4">
            {item.meta && (
              <span className="text-base font-semibold text-surface-900 dark:text-surface-50">
                {item.meta}
              </span>
            )}
            <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
              {actionLabel}
            </span>
          </div>
        </div>
      </article>
    );
  };

  const grid = (
    <div className={cn('grid grid-cols-1 gap-6', COLS[columns])}>
      {items.map((item) => {
        const content = tile(item);
        if (renderItem) return <div key={item.id}>{renderItem(item, content)}</div>;
        return item.href ? (
          <a key={item.id} href={item.href} className="block h-full">
            {content}
          </a>
        ) : (
          <div key={item.id}>{content}</div>
        );
      })}
    </div>
  );

  if (dark) {
    return (
      <div className={cn('bg-primary-900 px-6 py-16 dark:bg-surface-950', className)}>
        <div className="mx-auto max-w-7xl">{grid}</div>
      </div>
    );
  }

  return <div className={className}>{grid}</div>;
}

export default ItemGrid;
