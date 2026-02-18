/**
 * ContentCard — 统一卡片容器组件
 * 替代 home-card / overview-card / settings-card / content-card 等重复 CSS
 * 支持三种外观变体: default (bg-container), elevated (bg-elevated), subtle (fill-quaternary)
 */
import type { CSSProperties, ReactNode } from 'react'

export type ContentCardVariant = 'default' | 'elevated' | 'subtle'

export interface ContentCardProps {
  variant?: ContentCardVariant
  children: ReactNode
  className?: string
  style?: CSSProperties
  hoverable?: boolean
  /** 点击回调 */
  onClick?: () => void
}

export function ContentCard({
  variant = 'default',
  children,
  className,
  style,
  hoverable = true,
  onClick
}: ContentCardProps) {
  const cls = [
    'content-card',
    `content-card--${variant}`,
    hoverable && 'content-card--hoverable',
    onClick && 'content-card--clickable',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {children}
    </div>
  )
}

export interface ContentCardHeaderProps {
  children: ReactNode
  className?: string
}

export function ContentCardHeader({ children, className }: ContentCardHeaderProps) {
  return <div className={`content-card__header${className ? ` ${className}` : ''}`}>{children}</div>
}

export interface ContentCardBodyProps {
  children: ReactNode
  className?: string
}

export function ContentCardBody({ children, className }: ContentCardBodyProps) {
  return <div className={`content-card__body${className ? ` ${className}` : ''}`}>{children}</div>
}
