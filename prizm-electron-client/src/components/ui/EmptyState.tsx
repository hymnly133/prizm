/**
 * EmptyState — 统一的空状态组件
 * 替代各页面中反复出现的 empty-state 模式
 */
import type { ReactNode } from 'react'
import { Icon, Text } from '@lobehub/ui'
import type { LucideIcon } from 'lucide-react'

export interface EmptyStateProps {
  icon?: LucideIcon
  description: string
  actions?: ReactNode
  className?: string
}

export function EmptyState({ icon, description, actions, className }: EmptyStateProps) {
  return (
    <div className={`empty-state${className ? ` ${className}` : ''}`}>
      {icon && (
        <Icon icon={icon} size="small" style={{ color: 'var(--ant-color-text-quaternary)' }} />
      )}
      <Text type="secondary">{description}</Text>
      {actions && <div className="empty-state__actions">{actions}</div>}
    </div>
  )
}
