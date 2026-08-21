import { type ReactNode } from 'react';
import { ReactLenis } from 'lenis/react';
import { useReducedMotion } from 'motion/react';

export interface SmoothScrollProps {
  children: ReactNode;
}

/**
 * App-root wrapper that enables Lenis inertial/momentum smooth scrolling.
 * Mount ONCE at the shell root (App.tsx), wrapping the router outlet.
 * When the user prefers reduced motion, Lenis is fully unmounted (native
 * scrolling), so no RAF loop runs and nothing animates.
 */
function SmoothScroll({ children }: SmoothScrollProps) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <ReactLenis root options={{ lerp: 0.1, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}

export { SmoothScroll };
