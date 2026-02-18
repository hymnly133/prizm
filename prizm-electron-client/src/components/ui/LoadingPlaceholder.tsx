/**
 * LoadingPlaceholder — 统一的加载占位组件
 * 替代各页面中反复出现的 loading placeholder 模式
 */
import { Loader2 } from 'lucide-react'

export interface LoadingPlaceholderProps {
  text?: string
  className?: string
}

export function LoadingPlaceholder({ text = '加载中...', className }: LoadingPlaceholderProps) {
  return (
    <div className={`loading-placeholder${className ? ` ${className}` : ''}`}>
      <Loader2 size={14} className="spinning" />
      <span>{text}</span>
    </div>
  )
}
