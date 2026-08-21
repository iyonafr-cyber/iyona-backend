import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-100 text-surface-400 dark:bg-surface-800 dark:text-surface-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-surface-900 dark:text-surface-50">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-surface-500 dark:text-surface-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { EmptyState };
