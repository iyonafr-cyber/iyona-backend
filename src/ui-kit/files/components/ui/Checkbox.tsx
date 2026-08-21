import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const boxId = id ?? (label ? `cb-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const input = (
      <input
        ref={ref}
        id={boxId}
        type="checkbox"
        className={cn(
          'h-4 w-4 shrink-0 rounded-[var(--radius-sm)] border border-surface-300 text-primary-600',
          'accent-primary-600',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ring-offset-white dark:ring-offset-surface-950',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-surface-600 dark:bg-surface-900',
          className,
        )}
        {...props}
      />
    );
    if (!label) return input;
    return (
      <label htmlFor={boxId} className="inline-flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
        {input}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
export { Checkbox };
