/**
 * @ 引用与 / slash 命令提示候选框
 * 使用 @lobehub/ui List 组件，检测 @ 或 / 触发后展示候选并支持选择插入
 *
 * @ 引用：选中后添加到 inputRefs（引用栏），清除输入中的 @xxx 文本
 * / 命令：选中后替换为纯文本 /(cmd)
 */
import { Tag } from '@lobehub/ui'
import { AccentList } from '../../components/ui/AccentList'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatInputStore, useStoreApi } from './store'
import type { ScopeRefItem, SlashCommandItem } from './store/initialState'
import { encodeFilePathForRef } from '../../utils/fileRefEncoding'

function kindToKey(kind: string): string {
  switch (kind) {
    case 'document':
      return 'doc'
    case 'todoList':
      return 'todo'
    default:
      return kind
  }
}

/** 序列化格式：@(内容) 明确引用结束区域 */
function parseAtTrigger(content: string): {
  trigger: '@'
  query: string
  replaceStart: number
  replaceEnd: number
} | null {
  const lastAt = content.lastIndexOf('@')
  if (lastAt < 0) return null
  const after = content.slice(lastAt + 1)
  if (/^\([^)]+\)/.test(after)) return null
  const query = after.startsWith('(')
    ? after.slice(1).split(')')[0] ?? ''
    : after.search(/\s/) >= 0
    ? after.slice(0, after.search(/\s/))
    : after
  return {
    trigger: '@',
    query: query.toLowerCase().trim(),
    replaceStart: lastAt,
    replaceEnd: content.length
  }
}

/** 序列化格式：/(内容) 明确命令结束区域 */
function parseSlashTrigger(content: string): {
  trigger: '/'
  query: string
  replaceStart: number
  replaceEnd: number
} | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('/')) return null
  const after = trimmed.slice(1)
  if (/^\([^)]+\)/.test(after)) return null
  const query = after.startsWith('(')
    ? (after.slice(1).split(')')[0] ?? '').toLowerCase()
    : (after.search(/\s/) >= 0 ? after.slice(0, after.search(/\s/)) : after).toLowerCase()
  return {
    trigger: '/',
    query,
    replaceStart: content.length - trimmed.length,
    replaceEnd: content.length
  }
}

const MentionSlashOverlay = memo(() => {
  const storeApi = useStoreApi()
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
  const scrollFromKeyboardRef = useRef(false)
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {})

  const parsed = useMemo(() => {
    const at = parseAtTrigger(markdownContent)
    if (at) return at
    return parseSlashTrigger(markdownContent) ?? null
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
      if (!parsed || index < 0 || index >= candidates.length) return

      const applyText = storeApi.getState().applyOverlayTextReplace

      if (isAt) {
        const item = candidates[index] as ScopeRefItem
        const key = kindToKey(item.kind)
        const refKey = item.id
        const markdown = `@(${key}:${encodeFilePathForRef(refKey)})`
        const label = item.title.length > 30 ? item.title.slice(0, 30) + '…' : item.title

        storeApi.getState().addInputRef({
          type: key as 'doc' | 'note' | 'todo' | 'file',
          key: refKey,
          label,
          markdown
        })

        if (applyText) {
          applyText(parsed.replaceStart, parsed.replaceEnd, '')
        }
      } else {
        const cmd = candidates[index] as SlashCommandItem
        const replacement = `/(${cmd.name})`

        if (applyText) {
          applyText(parsed.replaceStart, parsed.replaceEnd, replacement)
        } else if (editor) {
          const before = markdownContent.slice(0, parsed.replaceStart)
          const after = markdownContent.slice(parsed.replaceEnd)
          setDocument('markdown', before + replacement + after)
        }
      }

      setSelectedIndex(0)
    },
    [parsed, editor, candidates, isAt, markdownContent, setDocument, storeApi]
  )

  const handleKeyDownGlobal = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        scrollFromKeyboardRef.current = true
        setSelectedIndex((i) => Math.min(i + 1, candidates.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        scrollFromKeyboardRef.current = true
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
  handlerRef.current = handleKeyDownGlobal

  const stableOverlayHandler = useCallback((e: KeyboardEvent) => {
    handlerRef.current?.(e)
  }, [])

  useEffect(() => {
    if (visible) {
      storeApi.getState().setOverlayKeyHandler(stableOverlayHandler)
    } else {
      storeApi.getState().setOverlayKeyHandler(null)
    }
    return () => {
      storeApi.getState().setOverlayKeyHandler(null)
    }
  }, [visible, stableOverlayHandler, storeApi])

  useEffect(() => {
    if (!visible || candidates.length === 0 || !scrollFromKeyboardRef.current) return
    scrollFromKeyboardRef.current = false
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
        const el = item!
        const containerHeight = container.clientHeight
        const maxScroll = container.scrollHeight - containerHeight
        if (maxScroll <= 0) return
        const itemTop = el.offsetTop
        const itemHeight = el.offsetHeight
        const targetScrollTop = itemTop - containerHeight / 2 + itemHeight / 2
        const clamped = Math.max(0, Math.min(maxScroll, targetScrollTop))
        container.scrollTo({ top: clamped, behavior: 'smooth' })
      })
    }
  }, [selectedIndex, visible, candidates.length])

  const listItems = useMemo(() => {
    return candidates.map((c, i) => {
      const isActive = selectedIndex === i
      if (isAt) {
        const item = c as ScopeRefItem
        const key = `${item.kind}:${item.id}`
        const refKey = kindToKey(item.kind)
        const title = item.title.length > 40 ? item.title.slice(0, 40) + '…' : item.title
        return {
          key,
          title: `@${refKey}:${item.id.slice(0, 8)} ${title}`,
          addon: <Tag>{refKey}</Tag>,
          active: isActive,
          onClick: () => selectItem(i),
          onMouseEnter: () => setSelectedIndex(i)
        }
      }
      const cmd = c as SlashCommandItem
      return {
        key: cmd.name,
        title: `/${cmd.name}`,
        addon: (
          <span className="mention-slash-desc">
            {!cmd.builtin && (
              <Tag style={{ fontSize: 10, marginRight: 4 }}>
                {cmd.mode === 'prompt' ? 'prompt' : 'action'}
              </Tag>
            )}
            {cmd.description}
          </span>
        ),
        active: isActive,
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
      <AccentList activeKey={activeKey} items={listItems} />
    </div>
  )
})

MentionSlashOverlay.displayName = 'MentionSlashOverlay'

export default MentionSlashOverlay
