/**
 * AccentList — 包装 @lobehub/ui List / List.Item，自动注入 accent color 和交互反馈
 *
 * LobeUI 的 List active 项默认使用中性灰 colorFillSecondary，不跟随 primaryColor。
 * 此包装自动为容器注入过渡动画，为 activeKey 匹配的项注入 accent 背景色，
 * 消费方无需手动添加 className。
 *
 * 用法：
 *   <AccentList activeKey={id} items={items} />           — 替代 <List>
 *   <AccentList.Item active={isActive} title="..." />     — 替代 <List.Item>
 */
import { List } from '@lobehub/ui'
import type { ListProps, ListItemProps } from '@lobehub/ui'
import { cx } from 'antd-style'
import { memo, useMemo } from 'react'

const CONTAINER_CLS = 'accent-list'
const ACTIVE_CLS = 'accent-list-active'

// ── AccentList：包装 <List items={...} activeKey={...}> ──

type AccentListProps = ListProps

const AccentList = memo(({ activeKey, items, className, ...rest }: AccentListProps) => {
  const patchedItems = useMemo(() => {
    if (!activeKey) return items
    return items.map((item) => {
      if (item.key !== activeKey) return item
      return { ...item, className: cx(ACTIVE_CLS, item.className) }
    })
  }, [items, activeKey])

  return (
    <List
      className={cx(CONTAINER_CLS, className)}
      activeKey={activeKey}
      items={patchedItems}
      {...rest}
    />
  )
})

AccentList.displayName = 'AccentList'

// ── AccentListItem：包装 <List.Item active={...}> ──

type AccentListItemProps = ListItemProps

const AccentListItem = memo(({ active, className, ...rest }: AccentListItemProps) => {
  return (
    <List.Item
      active={active}
      className={cx(active && ACTIVE_CLS, className)}
      {...rest}
    />
  )
})

AccentListItem.displayName = 'AccentListItem'

// ── 组合导出（支持 AccentList.Item 语法） ──

type AccentListComponent = typeof AccentList & {
  Item: typeof AccentListItem
}

const Compound = AccentList as AccentListComponent
Compound.Item = AccentListItem

export { Compound as AccentList, AccentListItem as AccentListItemComponent }
export type { AccentListProps, AccentListItemProps }
