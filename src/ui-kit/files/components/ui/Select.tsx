import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, id, children, ...props }, ref) => {
    const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-surface-700 dark:text-surface-300">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'h-10 w-full appearance-none rounded-[var(--radius-md)] border bg-white pl-3 pr-9 text-sm text-surface-900',
              'dark:bg-surface-900 dark:text-surface-50',
              'focus:outline-none focus:ring-2 focus:ring-offset-1 ring-offset-white dark:ring-offset-surface-950',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors',
              error
                ? 'border-error focus:ring-red-500'
                : 'border-surface-300 focus:ring-primary-500 dark:border-surface-700',
              className,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400"
            aria-hidden
          />
        </div>
        {error && (
          <p id={`${selectId}-error`} className="text-xs text-error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${selectId}-hint`} className="text-xs text-surface-400">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
export { Select };
