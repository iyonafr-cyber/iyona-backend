import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

/** Compact -/+ quantity control for carts and order forms. */
function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
}: QuantityStepperProps) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const btn =
    'flex h-9 w-9 items-center justify-center text-surface-600 transition-colors hover:bg-surface-100 disabled:pointer-events-none disabled:opacity-40 dark:text-surface-300 dark:hover:bg-surface-800';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[var(--radius-md)] border border-surface-300 dark:border-surface-700',
        className,
      )}
    >
      <button
        type="button"
        className={cn(btn, 'rounded-l-[var(--radius-md)]')}
        onClick={() => set(value - 1)}
        disabled={value <= min}
        aria-label="Decrease quantity"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) set(n);
        }}
        className="h-9 w-12 border-x border-surface-300 bg-transparent text-center text-sm font-medium text-surface-900 outline-none [appearance:textfield] dark:border-surface-700 dark:text-surface-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Quantity"
      />
      <button
        type="button"
        className={cn(btn, 'rounded-r-[var(--radius-md)]')}
        onClick={() => set(value + 1)}
        disabled={value >= max}
        aria-label="Increase quantity"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export { QuantityStepper };
