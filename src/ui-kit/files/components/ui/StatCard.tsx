import { type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Signed delta shown with an up/down arrow, e.g. "+12.5%". */
  change?: string;
  trend?: 'up' | 'down';
  className?: string;
}

/** Dashboard metric tile: label, big value, optional icon and trend delta. */
function StatCard({ label, value, icon, change, trend, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-surface-200 bg-white p-5 shadow-[var(--shadow-sm)]',
        'dark:border-surface-800 dark:bg-surface-900',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</p>
        {icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-bold text-surface-900 dark:text-surface-50">{value}</p>
        {change && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-sm font-medium',
              trend === 'down'
                ? 'text-red-600 dark:text-red-400'
                : 'text-green-600 dark:text-green-400',
            )}
          >
            {trend === 'down' ? (
              <ArrowDownRight className="h-4 w-4" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}

export { StatCard };
