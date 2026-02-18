/**
 * AppHeader - 自定义标题栏 + 导航栏
 *
 * 布局策略：
 *   nav 绝对定位 + transform 居中（相对整个窗口宽度）
 *   logo + pageSlots.left + actions 正常 flex 流式布局，用 padding 为 overlay 留白
 *   pageSlots 由各页面通过 HeaderSlotsContext 注册，仅渲染当前活跃页面的插槽
 *
 * 拖拽策略：
 *   header 整体 = drag
 *   仅 logo / nav / actions / slots 的内容 = no-drag
 */
import { Flexbox } from '@lobehub/ui'
import { createStyles } from 'antd-style'
import type { ReactNode } from 'react'
import { useActiveHeaderSlots } from '../../context/HeaderSlotsContext'

interface AppHeaderProps {
  logo?: ReactNode
  nav?: ReactNode
  actions?: ReactNode
  height?: number
}

const IS_WIN = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win')
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    position: relative;
    flex-shrink: 0;
    background: ${token.colorBgLayout};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  container: css`
    height: 100%;
    padding-left: ${IS_MAC ? 82 : 12}px;
    padding-right: ${IS_WIN ? 150 : 12}px;
  `,
  section: css`
    display: flex;
    align-items: center;
  `,
  leftSection: css`
    gap: 6px;
  `,
  rightSection: css`
    gap: 2px;
  `,
  divider: css`
    width: 1px;
    height: 14px;
    background: ${token.colorBorderSecondary};
    flex-shrink: 0;
  `,
  navContainer: css`
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  `
}))

export function AppHeader({ logo, nav, actions, height = 36 }: AppHeaderProps) {
  const { left: slotLeft, right: slotRight } = useActiveHeaderSlots()
  const { styles, cx } = useStyles()

  return (
    <header className={cx('app-titlebar-drag', styles.header)} style={{ height }}>
      {/* Logo + SlotLeft ... SlotRight + Actions: 正常 flex 流 */}
      <Flexbox horizontal align="center" justify="space-between" className={styles.container}>
        <span className={cx('app-titlebar-nodrag', styles.section, styles.leftSection)}>
          {logo}
          {slotLeft && (
            <>
              <span className={styles.divider} />
              {slotLeft}
            </>
          )}
        </span>

        <span className={cx('app-titlebar-nodrag', styles.section, styles.rightSection)}>
          {slotRight}
          {actions}
        </span>
      </Flexbox>

      {/* Nav: 绝对居中于整个标题栏 */}
      {nav && <div className={cx('app-titlebar-nodrag', styles.navContainer)}>{nav}</div>}
    </header>
  )
}
