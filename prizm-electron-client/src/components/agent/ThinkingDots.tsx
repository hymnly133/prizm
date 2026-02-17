/**
 * 三点呼吸脉冲动画 — 替代 CSS keyframes 的 motion 实现
 */
import { motion } from 'motion/react'
import { SPRING_GENTLE } from '../../theme/motionPresets'

interface ThinkingDotsProps {
  color?: string
  size?: number
  label?: string
}

export function ThinkingDots({
  color = 'var(--ant-color-primary)',
  size = 5,
  label
}: ThinkingDotsProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--ant-color-text-tertiary)'
      }}
    >
      <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              display: 'inline-block'
            }}
            animate={{ scale: [0.7, 1.2, 0.7], opacity: [0.3, 1, 0.3] }}
            transition={{
              ...SPRING_GENTLE,
              repeat: Infinity,
              repeatType: 'loop',
              duration: 1.2,
              delay: i * 0.15
            }}
          />
        ))}
      </span>
      {label && <span>{label}</span>}
    </span>
  )
}
