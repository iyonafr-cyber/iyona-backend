import { type ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
};

export interface StaggerProps {
  children: ReactNode;
  className?: string;
}

/** Container that reveals its <StaggerItem> children one after another (50ms apart). */
function Stagger({ children, className }: StaggerProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/** A single staggered child. Must be rendered inside a <Stagger>. */
function StaggerItem({ children, className }: StaggerProps) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

export { Stagger, StaggerItem };
