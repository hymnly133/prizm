/**
 * ModalSidebar — 统一的模态侧边栏组件
 *
 * 基于 antd Drawer 封装，提供一致的交互体验：
 *   - 关闭按钮统一靠内侧（朝屏幕中间），使用 accent 色突出显示
 *   - 统一的 header 布局：关闭按钮 | 标题 | 额外操作区
 *   - Drawer 区域排除标题栏，不遮挡窗口控制按钮
 *   - 统一的动画、间距、背景等视觉风格
 *
 * 用法：
 *   <ModalSidebar open={open} onClose={close} title={<><Icon /> 标题</>}>
 *     {children}
 *   </ModalSidebar>
 */
import { Drawer } from 'antd'
import { ActionIcon } from '@lobehub/ui'
import { X } from 'lucide-react'

const TITLEBAR_HEIGHT = 36

export interface ModalSidebarProps {
  open: boolean
  onClose: () => void
  /** 标题内容（支持 ReactNode，如带图标的标题） */
  title: React.ReactNode
  /** 抽屉宽度，默认 560 */
  width?: number | string
  /** 标题栏右侧的额外操作区 */
  extra?: React.ReactNode
  /** 抽屉方向，默认 right */
  placement?: 'left' | 'right'
  /** body 区域自定义样式 */
  bodyStyle?: React.CSSProperties
  /** 自定义 className */
  className?: string
  children: React.ReactNode
}

export function ModalSidebar({
  open,
  onClose,
  title,
  width = 560,
  extra,
  placement = 'right',
  bodyStyle,
  className,
  children
}: ModalSidebarProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      placement={placement}
      width={width}
      className={`modal-sidebar ${className ?? ''}`}
      rootStyle={{ top: TITLEBAR_HEIGHT }}
      styles={{
        header: {
          padding: '8px 12px',
          borderBottom: '1px solid var(--ant-color-border-secondary)'
        },
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...bodyStyle
        }
      }}
      title={
        <div className="modal-sidebar-header">
          <ActionIcon
            icon={X}
            size="small"
            onClick={onClose}
            title="关闭"
            className="modal-sidebar-close"
          />
          <div className="modal-sidebar-title">{title}</div>
          {extra && <div className="modal-sidebar-extra">{extra}</div>}
        </div>
      }
    >
      {children}
    </Drawer>
  )
}
