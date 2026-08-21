import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: Size;
  children: ReactNode;
}

const sizeStyles: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

function Modal({ open, onClose, title, description, size = 'md', children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'ui-modal w-full rounded-[var(--radius-xl)] border border-surface-200 bg-white p-0 shadow-[var(--shadow-xl)]',
        'dark:border-surface-800 dark:bg-surface-900',
        'backdrop:bg-surface-950/40 backdrop:backdrop-blur-sm',
        sizeStyles[size],
      )}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {title && <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">{title}</h2>}
            {description && <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

export { Modal };
