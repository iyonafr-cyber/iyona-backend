import { useState } from 'react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  src?: string;
  /** Full name — used for the alt text and the initials fallback. */
  name: string;
  size?: Size;
  className?: string;
}

const sizeStyles: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Circular avatar with a graceful initials fallback when the image is missing. */
function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const base = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold',
    sizeStyles[size],
    className,
  );

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        className={cn(base, 'object-cover')}
      />
    );
  }
  return (
    <span
      className={cn(base, 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300')}
      aria-label={name}
    >
      {initials(name) || '?'}
    </span>
  );
}

export { Avatar };
