/**
 * RefreshIconButton — 统一的刷新按钮组件
 * 替代各页面中样式各异的刷新按钮
 */
import { ActionIcon } from '@lobehub/ui'
import { RefreshCw } from 'lucide-react'

export interface RefreshIconButtonProps {
  onClick: () => void
  title?: string
  size?: number
  disabled?: boolean
  className?: string
}

export function RefreshIconButton({
  onClick,
  title = '刷新',
  size = 14,
  disabled = false,
  className
}: RefreshIconButtonProps) {
  // Map pixel size roughly to ActionIcon size presets or pass custom style
  // ActionIcon default is 'site' (middle), we can try to respect the size prop via style if needed,
  // but for consistency let's use 'small' as base and let className override.
  return (
    <ActionIcon
      icon={RefreshCw}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={{ fontSize: size }}
      size="small"
    />
  )
}
