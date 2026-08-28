import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** The site footer, as four real compositions. */
export type SiteFooterVariant =
  | 'columns-4'
  | 'minimal-row'
  | 'editorial'
  | 'bordered-grid';

export interface FooterLink {
  label: string;
  href: string;
}
export interface FooterGroup {
  title: string;
  links: FooterLink[];
}

export interface SiteFooterProps {
  variant?: SiteFooterVariant;
  wordmark: ReactNode;
  /** One short brand sentence under the wordmark. */
  blurb?: string;
  groups?: FooterGroup[];
  note?: string;
  social?: ReactNode;
  renderLink?: (link: FooterLink) => ReactNode;
  className?: string;
}

const LINK =
  'text-sm text-surface-600 transition-colors hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100';
const GROUP_TITLE =
  'text-[11px] font-bold uppercase tracking-[0.16em] text-surface-900 dark:text-surface-100';
const WORDMARK =
  'font-[family-name:var(--font-display)] font-bold tracking-[-0.02em] text-surface-900 dark:text-surface-50';

function Links({
  group,
  renderLink,
}: {
  group: FooterGroup;
  renderLink?: SiteFooterProps['renderLink'];
}) {
  return (
    <div>
      <p className={GROUP_TITLE}>{group.title}</p>
      <ul className="mt-4 space-y-2.5">
        {group.links.map((l) => (
          <li key={l.href}>
            {renderLink ? (
              renderLink(l)
            ) : (
              <a href={l.href} className={LINK}>
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({
  variant = 'columns-4',
  wordmark,
  blurb,
  groups = [],
  note,
  social,
  renderLink,
  className,
}: SiteFooterProps) {
  const shell = cn(
    'border-t border-surface-200 bg-white px-6 dark:border-surface-800 dark:bg-surface-950',
    className,
  );
  const Note = () =>
    note ? (
      <p className="text-xs text-surface-500 dark:text-surface-400">{note}</p>
    ) : null;

  if (variant === 'minimal-row') {
    return (
      <footer className={cn(shell, 'py-8')}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className={cn(WORDMARK, 'text-base')}>{wordmark}</div>
          <nav className="flex flex-wrap items-center gap-6">
            {groups.flatMap((g) => g.links).map((l) =>
              renderLink ? (
                <span key={l.href}>{renderLink(l)}</span>
              ) : (
                <a key={l.href} href={l.href} className={LINK}>
                  {l.label}
                </a>
              ),
            )}
          </nav>
          <div className="flex items-center gap-4">
            {social}
            <Note />
          </div>
        </div>
      </footer>
    );
  }

  if (variant === 'editorial') {
    return (
      <footer className={cn(shell, 'py-16')}>
        <div className="mx-auto max-w-7xl">
          <div
            className={cn(
              WORDMARK,
              'text-[clamp(2.5rem,8vw,5rem)] leading-none',
            )}
          >
            {wordmark}
          </div>
          {blurb && (
            <p className="mt-6 max-w-md text-surface-600 dark:text-surface-300">
              {blurb}
            </p>
          )}
          <div className="mt-12 grid grid-cols-2 gap-8 border-t border-surface-200 pt-10 md:grid-cols-4 dark:border-surface-800">
            {groups.map((g) => (
              <Links key={g.title} group={g} renderLink={renderLink} />
            ))}
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <Note />
            {social}
          </div>
        </div>
      </footer>
    );
  }

  if (variant === 'bordered-grid') {
    return (
      <footer className={cn(shell, 'py-0')}>
        <div className="mx-auto grid max-w-7xl grid-cols-1 md:grid-cols-4">
          <div className="border-b border-surface-200 p-8 md:border-b-0 md:border-r dark:border-surface-800">
            <div className={cn(WORDMARK, 'text-lg')}>{wordmark}</div>
            {blurb && (
              <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">
                {blurb}
              </p>
            )}
          </div>
          {groups.slice(0, 3).map((g) => (
            <div
              key={g.title}
              className="border-b border-surface-200 p-8 md:border-b-0 md:border-r last:md:border-r-0 dark:border-surface-800"
            >
              <Links group={g} renderLink={renderLink} />
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-surface-200 py-6 dark:border-surface-800">
          <Note />
          {social}
        </div>
      </footer>
    );
  }

  return (
    <footer className={cn(shell, 'py-14')}>
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-10 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <div className={cn(WORDMARK, 'text-lg')}>{wordmark}</div>
          {blurb && (
            <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">
              {blurb}
            </p>
          )}
        </div>
        {groups.slice(0, 3).map((g) => (
          <Links key={g.title} group={g} renderLink={renderLink} />
        ))}
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-start justify-between gap-4 border-t border-surface-200 pt-6 md:flex-row md:items-center dark:border-surface-800">
        <Note />
        {social}
      </div>
    </footer>
  );
}

export default SiteFooter;
