import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
  /** Render as a circle (avatar placeholder). */
  circle?: boolean;
}

function Skeleton({ className, circle }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-surface-200 dark:bg-surface-800',
        circle ? 'rounded-full' : 'rounded-[var(--radius-md)]',
        !className && 'h-4 w-full',
        className,
      )}
      aria-hidden
    />
  );
}

function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && 'w-3/4')} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText };
