/**
 * AppHeader - 自定义标题栏 + 导航栏
 *
 * 布局策略：
 *   nav 绝对定位 + transform 居中（相对整个窗口宽度）
 *   logo + actions 正常 flex 流式布局，用 padding 为 overlay 留白
 *
 * 拖拽策略：
 *   header 整体 = drag
 *   仅 logo / nav / actions 的内容 = no-drag
 */
import { Flexbox } from '@lobehub/ui'
import type { ReactNode } from 'react'

interface AppHeaderProps {
  logo?: ReactNode
  nav?: ReactNode
  actions?: ReactNode
  height?: number
}

const IS_WIN = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win')
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

export function AppHeader({ logo, nav, actions, height = 36 }: AppHeaderProps) {
  return (
    <header
      className="app-titlebar-drag"
      style={{
        position: 'relative',
        height,
        flexShrink: 0,
        background: 'var(--ant-color-bg-elevated)',
        borderBottom: '1px solid var(--ant-color-border)'
      }}
    >
      {/* Logo + Actions: 正常 flex 流 */}
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          height: '100%',
          paddingLeft: IS_MAC ? 82 : 12,
          paddingRight: IS_WIN ? 150 : 12
        }}
      >
        <span
          className="app-titlebar-nodrag"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {logo}
        </span>

        <span
          className="app-titlebar-nodrag"
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}
        >
          {actions}
        </span>
      </Flexbox>

      {/* Nav: 绝对居中于整个标题栏 */}
      {nav && (
        <div
          className="app-titlebar-nodrag"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          {nav}
        </div>
      )}
    </header>
  )
}
