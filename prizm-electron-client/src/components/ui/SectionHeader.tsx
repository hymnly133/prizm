/**
 * SectionHeader — 统一的分区标题组件
 * 替代各页面中反复出现的 section-header 模式
 */
import type { ReactNode } from 'react'
import { Icon, Tag } from '@lobehub/ui'
import type { LucideIcon } from 'lucide-react'

export interface SectionHeaderProps {
  icon?: LucideIcon
  title: string
  count?: number
  extra?: ReactNode
  className?: string
}

export function SectionHeader({ icon, title, count, extra, className }: SectionHeaderProps) {
  return (
    <div className={`section-header${className ? ` ${className}` : ''}`}>
      {icon && <Icon icon={icon} size="small" />}
      <span className="section-header__title">{title}</span>
      {count != null && <Tag size="small">{count}</Tag>}
      {extra && <span className="section-header__extra">{extra}</span>}
    </div>
  )
}
