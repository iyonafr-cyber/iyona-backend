import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Build a compact page list with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageList(page: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push('ellipsis');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('ellipsis');
  out.push(total);
  return out;
}

function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  const go = (p: number) => onPageChange(Math.min(totalPages, Math.max(1, p)));
  const btn =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-md)] px-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <nav aria-label="Pagination" className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        className={cn(btn, 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800')}
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e${i}`} className="px-1.5 text-surface-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              btn,
              p === page
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={cn(btn, 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800')}
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

export { Pagination };
