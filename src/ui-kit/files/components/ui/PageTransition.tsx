import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wrap each routed page. Fade + slight rise on enter, matching the standard
 * motion policy (300ms, ease-out). Under prefers-reduced-motion it renders a
 * plain div with no animation. For exit transitions, wrap <Routes> in
 * <AnimatePresence mode="wait"> keyed on the location pathname.
 */
function PageTransition({ children, className }: PageTransitionProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export { PageTransition };
