import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, rows = 4, ...props }, ref) => {
    const areaId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={areaId} className="text-sm font-medium text-surface-700 dark:text-surface-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          className={cn(
            'w-full rounded-[var(--radius-md)] border bg-white px-3 py-2 text-sm text-surface-900',
            'placeholder:text-surface-400',
            'dark:bg-surface-900 dark:text-surface-50 dark:placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-offset-1 ring-offset-white dark:ring-offset-surface-950',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-y transition-colors',
            error
              ? 'border-error focus:ring-red-500'
              : 'border-surface-300 focus:ring-primary-500 dark:border-surface-700',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${areaId}-error` : hint ? `${areaId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${areaId}-error`} className="text-xs text-error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${areaId}-hint`} className="text-xs text-surface-400">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
export { Textarea };
