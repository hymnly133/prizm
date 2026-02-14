/**
 * @ 引用与 / slash 命令提示候选框
 * 使用 @lobehub/ui List 组件，检测 @ 或 / 触发后展示候选并支持选择插入
 */
import { List, Tag } from '@lobehub/ui'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatInputStore } from './store'
import type { ScopeRefItem, SlashCommandItem } from './store/initialState'

function kindToKey(kind: string): string {
  return kind === 'document' ? 'doc' : kind
}

/** 解析 @ 触发：返回 { trigger, query, replaceStart, replaceEnd } 或 null */
function parseAtTrigger(content: string): {
  trigger: '@'
  query: string
  replaceStart: number
  replaceEnd: number
} | null {
  const lastAt = content.lastIndexOf('@')
  if (lastAt < 0) return null
  const after = content.slice(lastAt + 1)
  const spaceIdx = after.search(/\s/)
  const query = spaceIdx >= 0 ? after.slice(0, spaceIdx) : after
  return {
    trigger: '@',
    query: query.toLowerCase().trim(),
    replaceStart: lastAt,
    replaceEnd: content.length
  }
}

/** 解析 / 触发：返回 { trigger, query, replaceStart, replaceEnd } 或 null */
function parseSlashTrigger(content: string): {
  trigger: '/'
  query: string
  replaceStart: number
  replaceEnd: number
} | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('/')) return null
  const after = trimmed.slice(1)
  const spaceIdx = after.search(/\s/)
  const query = spaceIdx >= 0 ? after.slice(0, spaceIdx).toLowerCase() : after.toLowerCase()
  return {
    trigger: '/',
    query,
    replaceStart: 0,
    replaceEnd: content.length
  }
}

const MentionSlashOverlay = memo(() => {
  const [markdownContent, editor, scopeItems, scopeSlashCommands, setDocument] = useChatInputStore(
    (s) => [
      s.markdownContent,
      s.editor,
      s.scopeItems ?? [],
      s.scopeSlashCommands ?? [],
      s.setDocument
    ]
  )

  const [selectedIndex, setSelectedIndex] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo(() => {
    const at = parseAtTrigger(markdownContent)
    if (at) return at
    const slash = parseSlashTrigger(markdownContent)
    return slash ?? null
  }, [markdownContent])

  const candidates = useMemo(() => {
    if (!parsed) return []
    if (parsed.trigger === '@') {
      const q = parsed.query
      const filtered = !q
        ? scopeItems
        : scopeItems.filter(
            (item) =>
              kindToKey(item.kind).includes(q) ||
              item.title.toLowerCase().includes(q) ||
              item.id.toLowerCase().includes(q)
          )
      return filtered.slice(0, 20) as ScopeRefItem[]
    }
    // slash
    const q = parsed.query
    const filtered = !q
      ? scopeSlashCommands
      : scopeSlashCommands.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.aliases.some((a) => a.toLowerCase().includes(q)) ||
            c.description.toLowerCase().includes(q)
        )
    return filtered.slice(0, 15) as SlashCommandItem[]
  }, [parsed, scopeItems, scopeSlashCommands])

  useEffect(() => {
    setSelectedIndex(0)
  }, [parsed?.trigger, parsed?.query, candidates.length])

  const isAt = parsed?.trigger === '@'
  const visible = !!parsed && candidates.length > 0

  const selectItem = useCallback(
    (index: number) => {
      if (!parsed || !editor || index < 0 || index >= candidates.length) return
      const before = markdownContent.slice(0, parsed.replaceStart)
      const after = markdownContent.slice(parsed.replaceEnd)
      let replacement: string
      if (isAt) {
        const item = candidates[index] as ScopeRefItem
        const key = kindToKey(item.kind)
        replacement = `@${key}:${item.id} `
      } else {
        const cmd = candidates[index] as SlashCommandItem
        replacement = `/${cmd.name} `
      }
      const newContent = before + replacement + after
      setDocument('markdown', newContent)
      setSelectedIndex(0)
    },
    [parsed, editor, candidates, isAt, markdownContent, setDocument]
  )

  const handleKeyDownGlobal = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((i) => Math.min(i + 1, candidates.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        selectItem(selectedIndex)
        return
      }
      if (e.key === 'Escape') {
        setSelectedIndex(0)
      }
    },
    [visible, candidates.length, selectedIndex, selectItem]
  )

  useEffect(() => {
    if (!visible) return
    window.addEventListener('keydown', handleKeyDownGlobal, true)
    return () => window.removeEventListener('keydown', handleKeyDownGlobal, true)
  }, [visible, handleKeyDownGlobal])

  // 键盘切换候选项时，将当前选中项滚动到可视区域
  useEffect(() => {
    if (!visible || candidates.length === 0) return
    const container = overlayRef.current
    if (!container) return
    const listRoot = container.firstElementChild
    let item: HTMLElement | undefined = listRoot?.children[selectedIndex] as HTMLElement | undefined
    if (!item && listRoot) {
      const byRole = listRoot.querySelectorAll('[role="option"], [role="menuitem"]')
      item = byRole[selectedIndex] as HTMLElement | undefined
    }
    if (!item && listRoot) {
      const byClass = listRoot.querySelectorAll('[class*="list-item"], [class*="ListItem"]')
      item = byClass[selectedIndex] as HTMLElement | undefined
    }
    if (item) {
      requestAnimationFrame(() => {
        item!.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }, [selectedIndex, visible, candidates.length])

  const listItems = useMemo(() => {
    return candidates.map((c, i) => {
      if (isAt) {
        const item = c as ScopeRefItem
        const key = `${item.kind}:${item.id}`
        const refKey = kindToKey(item.kind)
        const title = item.title.length > 40 ? item.title.slice(0, 40) + '…' : item.title
        return {
          key,
          title: `@${refKey}:${item.id.slice(0, 8)} ${title}`,
          addon: <Tag>{refKey}</Tag>,
          active: selectedIndex === i,
          onClick: () => selectItem(i),
          onMouseEnter: () => setSelectedIndex(i)
        }
      }
      const cmd = c as SlashCommandItem
      return {
        key: cmd.name,
        title: `/${cmd.name}`,
        addon: cmd.description ? (
          <span className="mention-slash-desc">{cmd.description}</span>
        ) : null,
        active: selectedIndex === i,
        onClick: () => selectItem(i),
        onMouseEnter: () => setSelectedIndex(i)
      }
    })
  }, [candidates, isAt, selectedIndex, selectItem])

  const activeKey = useMemo(() => {
    if (candidates.length === 0 || selectedIndex < 0 || selectedIndex >= candidates.length)
      return undefined
    const c = candidates[selectedIndex]
    return isAt
      ? `${(c as ScopeRefItem).kind}:${(c as ScopeRefItem).id}`
      : (c as SlashCommandItem).name
  }, [candidates, isAt, selectedIndex])

  if (!visible) return null

  return (
    <div
      ref={overlayRef}
      className="mention-slash-overlay"
      role="listbox"
      tabIndex={-1}
      aria-label={isAt ? '引用候选' : '命令候选'}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '100%',
        zIndex: 100,
        marginBottom: 4,
        maxHeight: 280,
        overflow: 'auto',
        background: 'var(--ant-color-bg-elevated, var(--colorBgContainer, #fff))',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,.12)',
        border: '1px solid var(--ant-color-border, var(--colorBorder, #d9d9d9))',
        padding: 4
      }}
    >
      <List activeKey={activeKey} items={listItems} />
    </div>
  )
})

MentionSlashOverlay.displayName = 'MentionSlashOverlay'

export default MentionSlashOverlay
