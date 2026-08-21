import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AccordionContextValue {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordion(): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('Accordion parts must be used within <Accordion>');
  return ctx;
}

export interface AccordionProps extends HTMLAttributes<HTMLDivElement> {
  /** 'single' closes others on open; 'multiple' allows many open. */
  type?: 'single' | 'multiple';
  defaultValue?: string[];
}

/** Collapsible sections — ideal for FAQs and product/spec details. */
function Accordion({
  type = 'single',
  defaultValue = [],
  className,
  children,
  ...props
}: AccordionProps) {
  const [open, setOpen] = useState<string[]>(defaultValue);
  const isOpen = (value: string) => open.includes(value);
  const toggle = (value: string) =>
    setOpen((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return type === 'single' ? [value] : [...prev, value];
    });
  return (
    <AccordionContext.Provider value={{ isOpen, toggle }}>
      <div
        className={cn(
          'divide-y divide-surface-200 rounded-[var(--radius-lg)] border border-surface-200 dark:divide-surface-800 dark:border-surface-800',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  value: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

function AccordionItem({ value, title, children, className }: AccordionItemProps) {
  const { isOpen, toggle } = useAccordion();
  const open = isOpen(value);
  return (
    <div className={cn('px-4', className)}>
      <button
        type="button"
        onClick={() => toggle(value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-surface-900 transition-colors hover:text-primary-600 dark:text-surface-100"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="pb-4 text-sm leading-relaxed text-surface-600 dark:text-surface-400">
          {children}
        </div>
      )}
    </div>
  );
}

export { Accordion, AccordionItem };
