/**
 * 数字递增动画组件 — 使用 motion useSpring
 */
import { useSpring, useTransform, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

interface AnimatedCounterProps {
  value: number
  format?: (n: number) => string
  className?: string
  style?: React.CSSProperties
  duration?: number
}

function defaultFormat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function AnimatedCounter({
  value,
  format = defaultFormat,
  className,
  style,
  duration = 0.6
}: AnimatedCounterProps) {
  const spring = useSpring(0, { duration: duration * 1000 })
  const display = useTransform(spring, (v) => format(v))
  const prevValue = useRef(0)

  useEffect(() => {
    if (value !== prevValue.current) {
      spring.set(value)
      prevValue.current = value
    }
  }, [value, spring])

  return (
    <motion.span className={className} style={style}>
      {display}
    </motion.span>
  )
}
