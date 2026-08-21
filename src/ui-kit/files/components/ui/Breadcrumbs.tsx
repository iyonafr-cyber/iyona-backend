import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface BreadcrumbItem {
  label: ReactNode;
  /** Optional link target. Omit for the current (last) page. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Navigation context trail. Pass plain hrefs, or wrap the whole component's
 * items with your router's <Link> upstream if you need SPA navigation.
 */
function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-surface-500 dark:text-surface-400">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li className="flex items-center">
                {item.href && !last ? (
                  <a
                    href={item.href}
                    className="transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    className={cn(last && 'font-medium text-surface-900 dark:text-surface-100')}
                    aria-current={last ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-surface-300 dark:text-surface-600" aria-hidden />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export { Breadcrumbs };
