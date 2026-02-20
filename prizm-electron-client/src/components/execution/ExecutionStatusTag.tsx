/**
 * ExecutionStatusTag — 通用执行状态标签
 *
 * Task / Workflow / BG Session 共用，通过 status 字符串渲染彩色标签。
 */

import { Tag } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
  PauseCircleOutlined,
  MinusCircleOutlined
} from '@ant-design/icons'

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <ThunderboltOutlined />, label: '运行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  success: { color: 'success', icon: <CheckCircleOutlined />, label: '成功' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
  timeout: { color: 'warning', icon: <ExclamationCircleOutlined />, label: '超时' },
  cancelled: { color: 'default', icon: <PauseCircleOutlined />, label: '已取消' },
  interrupted: { color: 'orange', icon: <ExclamationCircleOutlined />, label: '已中断' },
  paused: { color: 'warning', icon: <PauseCircleOutlined />, label: '暂停' },
  skipped: { color: 'default', icon: <MinusCircleOutlined />, label: '跳过' }
}

export interface ExecutionStatusTagProps {
  status: string
  size?: 'small' | 'default'
}

export function ExecutionStatusTag({ status, size }: ExecutionStatusTagProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <Tag
      icon={cfg.icon}
      color={cfg.color}
      className={`exec-status-tag exec-status-tag--${status}`}
      style={size === 'small' ? { fontSize: 11, lineHeight: '18px' } : undefined}
    >
      {cfg.label}
    </Tag>
  )
}
