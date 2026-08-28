import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The public site header, as five real compositions.
 *
 * WHY: nothing in the pipeline ever varied the header, and the plan prompt
 * asked the brain to be "prescriptive" about a shell that feels "uniform" — so
 * every generated site shipped the same bar: wordmark left, nav centre, one
 * outlined CTA right. The variant is seeded per project and renders here.
 *
 * Nav items render through `renderLink` when provided so the app can use its
 * router; otherwise plain anchors.
 */

export type SiteHeaderVariant =
  | 'classic'
  | 'split'
  | 'stacked'
  | 'minimal'
  | 'bordered-bar';

export interface HeaderLink {
  label: string;
  href: string;
}

export interface SiteHeaderProps {
  variant?: SiteHeaderVariant;
  wordmark: ReactNode;
  links?: HeaderLink[];
  action?: HeaderLink;
  /** Rendered at the right on mobile; wire it to your Drawer. */
  mobileMenu?: ReactNode;
  renderLink?: (link: HeaderLink) => ReactNode;
  sticky?: boolean;
  className?: string;
}

const NAV_LINK =
  'text-sm font-medium text-surface-600 transition-colors hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-50';
const NAV_LINK_CAPS =
  'text-xs font-bold uppercase tracking-[0.14em] text-surface-600 transition-colors hover:text-surface-900 dark:text-surface-300 dark:hover:text-surface-50';
const ACTION =
  'inline-flex h-10 items-center justify-center border border-surface-300 px-4 text-sm font-medium text-surface-800 transition-colors hover:bg-surface-50 rounded-[var(--radius-md)] dark:border-surface-700 dark:text-surface-100 dark:hover:bg-surface-800';
const WORDMARK =
  'font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.02em] text-surface-900 dark:text-surface-50';

function Nav({
  links,
  renderLink,
  caps,
  className,
}: Pick<SiteHeaderProps, 'links' | 'renderLink'> & {
  caps?: boolean;
  className?: string;
}) {
  if (!links?.length) return null;
  return (
    <nav className={cn('items-center gap-8', className)}>
      {links.map((l) =>
        renderLink ? (
          <span key={l.href}>{renderLink(l)}</span>
        ) : (
          <a key={l.href} href={l.href} className={caps ? NAV_LINK_CAPS : NAV_LINK}>
            {l.label}
          </a>
        ),
      )}
    </nav>
  );
}

function Action({
  action,
  renderLink,
}: Pick<SiteHeaderProps, 'action' | 'renderLink'>) {
  if (!action) return null;
  if (renderLink) return <>{renderLink(action)}</>;
  return (
    <a href={action.href} className={ACTION}>
      {action.label}
    </a>
  );
}

export function SiteHeader({
  variant = 'classic',
  wordmark,
  links,
  action,
  mobileMenu,
  renderLink,
  sticky = true,
  className,
}: SiteHeaderProps) {
  const shell = cn(
    'w-full border-b border-surface-200 bg-white/95 backdrop-blur dark:border-surface-800 dark:bg-surface-950/95',
    sticky && 'sticky top-0 z-40',
    className,
  );

  if (variant === 'stacked') {
    return (
      <header className={shell}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className={WORDMARK}>{wordmark}</div>
          <div className="flex items-center gap-3">
            <Action action={action} renderLink={renderLink} />
            <span className="md:hidden">{mobileMenu}</span>
          </div>
        </div>
        <div className="border-t border-surface-200 dark:border-surface-800">
          <Nav
            links={links}
            renderLink={renderLink}
            caps
            className="mx-auto hidden max-w-7xl px-6 py-3 md:flex"
          />
        </div>
      </header>
    );
  }

  if (variant === 'split') {
    return (
      <header className={shell}>
        <div className="mx-auto grid h-[72px] max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-6">
          <Nav links={links} renderLink={renderLink} className="hidden md:flex" />
          <div className={cn(WORDMARK, 'justify-self-center text-xl')}>
            {wordmark}
          </div>
          <div className="flex items-center justify-end gap-3">
            <span className="hidden md:block">
              <Action action={action} renderLink={renderLink} />
            </span>
            <span className="md:hidden">{mobileMenu}</span>
          </div>
        </div>
      </header>
    );
  }

  if (variant === 'minimal') {
    return (
      <header className={shell}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className={WORDMARK}>{wordmark}</div>
          <div className="flex items-center gap-4">
            <Nav
              links={links}
              renderLink={renderLink}
              className="hidden lg:flex"
            />
            {mobileMenu}
          </div>
        </div>
      </header>
    );
  }

  if (variant === 'bordered-bar') {
    return (
      <header
        className={cn(
          'w-full border-b-2 border-surface-900 bg-white dark:border-surface-100 dark:bg-surface-950',
          sticky && 'sticky top-0 z-40',
          className,
        )}
      >
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-6">
          <div
            className={cn(
              WORDMARK,
              'text-base uppercase tracking-[0.22em]',
            )}
          >
            {wordmark}
          </div>
          <Nav
            links={links}
            renderLink={renderLink}
            caps
            className="hidden md:flex"
          />
          <div className="flex items-center gap-3">
            <span className="hidden md:block">
              <Action action={action} renderLink={renderLink} />
            </span>
            <span className="md:hidden">{mobileMenu}</span>
          </div>
        </div>
      </header>
    );
  }

  // classic
  return (
    <header className={shell}>
      <div className="relative mx-auto flex h-[72px] max-w-7xl items-center justify-between px-6">
        <div className={WORDMARK}>{wordmark}</div>
        <Nav
          links={links}
          renderLink={renderLink}
          className="absolute left-1/2 hidden -translate-x-1/2 md:flex"
        />
        <div className="flex items-center gap-3">
          <span className="hidden md:block">
            <Action action={action} renderLink={renderLink} />
          </span>
          <span className="md:hidden">{mobileMenu}</span>
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
