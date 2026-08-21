import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-surface-700 dark:text-surface-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 w-full rounded-[var(--radius-md)] border bg-white px-3 text-sm text-surface-900',
            'placeholder:text-surface-400',
            'dark:bg-surface-900 dark:text-surface-50 dark:placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-offset-1 ring-offset-white dark:ring-offset-surface-950',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors',
            error
              ? 'border-error focus:ring-red-500'
              : 'border-surface-300 focus:ring-primary-500 dark:border-surface-700',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-error" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-xs text-surface-400">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
export { Input };
