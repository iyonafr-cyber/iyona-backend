import { type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Show a red asterisk to indicate a required field. */
  required?: boolean;
}

function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        'text-sm font-medium text-surface-700 dark:text-surface-300',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-error">*</span>}
    </label>
  );
}

export { Label };
