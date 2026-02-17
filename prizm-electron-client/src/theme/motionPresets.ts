/**
 * Motion 动画预设 — Agent 页面 + 全局共享
 * 基于 motion/react (framer-motion v12)
 */
import type { Transition, Variants, Easing } from 'motion/react'

/* ── 缓动曲线 ── */
export const EASE_SMOOTH: Easing = [0.33, 1, 0.68, 1]
export const EASE_OUT_EXPO: Easing = [0.16, 1, 0.3, 1]

export const SPRING_GENTLE: Transition = { type: 'spring', stiffness: 260, damping: 24 }
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 400, damping: 30 }

/* ── 时间常量 ── */
export const STAGGER_DELAY = 0.06

/* ── 基础动画工厂 ── */
export function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 12 } as const,
    animate: { opacity: 1, y: 0 } as const,
    transition: { delay, duration: 0.35, ease: EASE_SMOOTH } as Transition
  }
}

export function fadeIn(delay = 0) {
  return {
    initial: { opacity: 0 } as const,
    animate: { opacity: 1 } as const,
    transition: { delay, duration: 0.3, ease: EASE_SMOOTH } as Transition
  }
}

export function scaleIn(delay = 0) {
  return {
    initial: { opacity: 0, scale: 0.95 } as const,
    animate: { opacity: 1, scale: 1 } as const,
    transition: { delay, duration: 0.25, ease: EASE_SMOOTH } as Transition
  }
}

export function slideInRight(delay = 0) {
  return {
    initial: { opacity: 0, x: 20 } as const,
    animate: { opacity: 1, x: 0 } as const,
    exit: { opacity: 0, x: 20 } as const,
    transition: { delay, duration: 0.3, ease: EASE_SMOOTH } as Transition
  }
}

export function slideInLeft(delay = 0) {
  return {
    initial: { opacity: 0, x: -20 } as const,
    animate: { opacity: 1, x: 0 } as const,
    exit: { opacity: 0, x: -20 } as const,
    transition: { delay, duration: 0.3, ease: EASE_SMOOTH } as Transition
  }
}

/* ── AnimatePresence 用的 Variants ── */

/** 列表项 stagger 入场 */
export const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: STAGGER_DELAY }
  }
}

export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_SMOOTH } }
}

/** 面板 crossfade (会话切换) */
export const panelCrossfade: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 }
}

export const panelCrossfadeTransition: Transition = {
  duration: 0.2,
  ease: EASE_SMOOTH
}

/** 卡片展开 */
export const expandVariants: Variants = {
  collapsed: { height: 0, opacity: 0, overflow: 'hidden' },
  expanded: { height: 'auto', opacity: 1, overflow: 'hidden' }
}

export const expandTransition: Transition = {
  duration: 0.25,
  ease: EASE_SMOOTH
}

/** 工具卡片状态色 */
export const TOOL_STATUS_COLORS = {
  preparing: 'var(--ant-color-text-quaternary)',
  running: 'var(--ant-color-primary)',
  success: 'var(--ant-color-success)',
  error: 'var(--ant-color-error)'
} as const

/* ── reduced-motion 辅助 ── */
export function getReducedMotionProps() {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return { initial: false, animate: false, exit: false, transition: { duration: 0 } }
  }
  return {}
}
