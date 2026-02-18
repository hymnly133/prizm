/**
 * StatCard — 统一统计卡片组件
 * 替代 home-stat-card / devtools-status-card / agent-overview-stat-row
 * 两种尺寸: normal (icon 40px, value 20px) / compact (icon 可选, value 14px)
 */
import type { CSSProperties, ReactNode } from 'react'

export type StatCardSize = 'normal' | 'compact'

export interface StatCardProps {
  icon?: ReactNode
  iconColor?: string
  label: string
  value: string | ReactNode
  description?: string
  size?: StatCardSize
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function StatCard({
  icon,
  iconColor,
  label,
  value,
  description,
  size = 'normal',
  onClick,
  className,
  style
}: StatCardProps) {
  const cls = [
    'stat-card',
    `stat-card--${size}`,
    onClick && 'stat-card--clickable',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={style}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {icon && (
        <div className="stat-card__icon" style={iconColor ? { color: iconColor } : undefined}>
          {icon}
        </div>
      )}
      <div className="stat-card__info">
        {size === 'compact' ? (
          <>
            <span className="stat-card__label">{label}</span>
            <span className="stat-card__value">{value}</span>
          </>
        ) : (
          <>
            <span className="stat-card__value">{value}</span>
            <span className="stat-card__label">{label}</span>
            {description != null && <span className="stat-card__desc">{description}</span>}
          </>
        )}
      </div>
    </div>
  )
}
