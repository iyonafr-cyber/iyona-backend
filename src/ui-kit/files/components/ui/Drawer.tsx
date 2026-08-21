import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Side = 'right' | 'left';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: Side;
  title?: string;
  children: ReactNode;
}

const sideStyles: Record<Side, string> = {
  right: 'ml-auto mr-0',
  left: 'mr-auto ml-0',
};

/**
 * Side sheet built on the native <dialog> (same a11y/backdrop behaviour as
 * Modal). Ideal for a cart slide-over, filters panel, or mobile nav.
 */
function Drawer({ open, onClose, side = 'right', title, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={cn(
        'my-0 h-full max-h-none w-full max-w-sm border-surface-200 bg-white p-0 shadow-[var(--shadow-xl)]',
        'dark:border-surface-800 dark:bg-surface-900',
        'backdrop:bg-surface-950/40 backdrop:backdrop-blur-sm',
        sideStyles[side],
      )}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-surface-200 p-4 dark:border-surface-800">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}

export { Drawer };
