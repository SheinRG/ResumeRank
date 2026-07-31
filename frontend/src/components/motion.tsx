"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";

type FadeInProps = ComponentProps<typeof motion.div> & {
  children: ReactNode;
  delay?: number;
};

function FadeIn({ children, delay = 0, ...props }: FadeInProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

const staggerContainerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: "easeOut" },
  },
};

type StaggerProps = ComponentProps<typeof motion.div> & {
  children: ReactNode;
};

function Stagger({ children, ...props }: StaggerProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={staggerContainerVariants}
      {...props}
    >
      {children}
    </motion.div>
  );
}

type StaggerItemProps = ComponentProps<typeof motion.div> & {
  children: ReactNode;
};

function StaggerItem({ children, ...props }: StaggerItemProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div>{children}</div>;
  }

  return (
    <motion.div variants={staggerItemVariants} {...props}>
      {children}
    </motion.div>
  );
}

type ScaleInProps = ComponentProps<typeof motion.div> & {
  children: ReactNode;
};

function ScaleIn({ children, ...props }: ScaleInProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export { FadeIn, Stagger, StaggerItem, ScaleIn };
