/**
 * @ 引用与 / slash 命令下拉叠加层
 * 检测输入中的 @ 或 /，展示候选并支持选择插入
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
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

  if (!visible) return null

  return (
    <div
      className="mention-slash-overlay"
      role="listbox"
      tabIndex={-1}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '100%',
        zIndex: 100,
        marginTop: 4,
        maxHeight: 240,
        overflow: 'auto',
        background: 'var(--colorBgContainer, #fff)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,.15)',
        border: '1px solid var(--colorBorder, #d9d9d9)',
        padding: 4
      }}
    >
      {candidates.map((c, i) => (
        <button
          key={
            isAt
              ? `${(c as ScopeRefItem).kind}:${(c as ScopeRefItem).id}`
              : (c as SlashCommandItem).name
          }
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          className={`mention-slash-item ${i === selectedIndex ? 'selected' : ''}`}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 12px',
            border: 'none',
            background: i === selectedIndex ? 'var(--colorPrimaryBg, #e6f4ff)' : 'transparent',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13
          }}
          onClick={() => selectItem(i)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {isAt ? (
            <>
              <span style={{ color: 'var(--colorTextSecondary, #8c8c8c)' }}>
                @{kindToKey((c as ScopeRefItem).kind)}:{(c as ScopeRefItem).id.slice(0, 8)}
              </span>{' '}
              {(c as ScopeRefItem).title.slice(0, 40)}
              {(c as ScopeRefItem).title.length > 40 ? '…' : ''}
            </>
          ) : (
            <>
              <span style={{ fontWeight: 600 }}>{`/${(c as SlashCommandItem).name}`}</span>{' '}
              <span style={{ color: 'var(--colorTextSecondary, #8c8c8c)' }}>
                {(c as SlashCommandItem).description}
              </span>
            </>
          )}
        </button>
      ))}
    </div>
  )
})

MentionSlashOverlay.displayName = 'MentionSlashOverlay'

export default MentionSlashOverlay
