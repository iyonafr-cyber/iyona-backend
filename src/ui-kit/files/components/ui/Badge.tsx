import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variantStyles: Record<Variant, string> = {
  default:
    'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300',
  primary:
    'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  success:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  warning:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  error:
    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  outline:
    'border border-surface-300 text-surface-700 dark:border-surface-700 dark:text-surface-300',
};

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-full)] px-2.5 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
