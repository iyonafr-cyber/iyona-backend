import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg';

export interface RatingStarsProps {
  value: number;
  max?: number;
  size?: Size;
  /** When provided the stars become interactive (click to set). */
  onChange?: (value: number) => void;
  /** Optional count shown next to the stars, e.g. 128 reviews. */
  count?: number;
  className?: string;
}

const sizeStyles: Record<Size, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

/** Read-only or interactive star rating with half-star rendering. */
function RatingStars({
  value,
  max = 5,
  size = 'md',
  onChange,
  count,
  className,
}: RatingStarsProps) {
  const interactive = typeof onChange === 'function';
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <div className="inline-flex items-center gap-0.5">
        {Array.from({ length: max }, (_, i) => {
          const filled = i + 1 <= Math.round(value);
          const star = (
            <Star
              className={cn(
                sizeStyles[size],
                filled
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-surface-300 dark:text-surface-600',
              )}
            />
          );
          return interactive ? (
            <button
              key={i}
              type="button"
              onClick={() => onChange!(i + 1)}
              aria-label={`Rate ${i + 1} of ${max}`}
              className="transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
            >
              {star}
            </button>
          ) : (
            <span key={i}>{star}</span>
          );
        })}
      </div>
      {typeof count === 'number' && (
        <span className="text-sm text-surface-500 dark:text-surface-400">
          ({count.toLocaleString()})
        </span>
      )}
    </div>
  );
}

export { RatingStars };
