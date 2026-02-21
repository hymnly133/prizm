/**
 * @ 引用与 / slash 命令提示候选框
 *
 * @ 引用：按资源类型分组显示，每组带类型图标 + 分组头，选中后添加到 inputRefs
 * / 命令：选中后替换为纯文本 /(cmd)
 * / 命令二级：输入 /skill list 等时显示子命令/参数候选
 */
import { Tag } from '@lobehub/ui'
import { AccentList } from '../../components/ui/AccentList'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatInputStore, useStoreApi } from './store'
import type { InputRef, ScopeRefItem, SlashCommandItem } from './store/initialState'
import { encodeFilePathForRef } from '../../utils/fileRefEncoding'
import {
  FileText,
  CheckSquare,
  File,
  Blocks,
  GitBranch,
  Zap,
  MessageSquare,
  Calendar,
  Clock,
  Brain,
  Search
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

function itemToRefKey(item: ScopeRefItem): string {
  if (item.type) return item.type
  switch (item.kind) {
    case 'document':
      return 'doc'
    case 'todoList':
      return 'todo'
    default:
      return item.kind
  }
}

const TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon; accent: string }> = {
  doc: { label: '文档', icon: FileText, accent: 'var(--ant-color-primary, #1677ff)' },
  todo: { label: '待办', icon: CheckSquare, accent: 'var(--ant-color-info-text, #0958d9)' },
  file: { label: '文件', icon: File, accent: 'var(--ant-color-warning-text, #d46b08)' },
  workflow: { label: '工作流', icon: Blocks, accent: '#722ed1' },
  run: { label: '运行', icon: GitBranch, accent: '#13c2c2' },
  task: { label: '任务', icon: Zap, accent: 'var(--ant-color-success-text, #389e0d)' },
  session: { label: '会话', icon: MessageSquare, accent: '#8c8c8c' },
  schedule: { label: '日程', icon: Calendar, accent: '#eb2f96' },
  cron: { label: '定时', icon: Clock, accent: '#fa8c16' },
  memory: { label: '记忆', icon: Brain, accent: '#722ed1' }
}

/** Slash 命令分类顺序与展示文案 */
const SLASH_CATEGORY_ORDER = ['data', 'search', 'session', 'skill', 'custom'] as const
const SLASH_CATEGORY_CONFIG: Record<string, { label: string; icon: LucideIcon }> = {
  data: { label: '数据', icon: FileText },
  search: { label: '搜索', icon: Search },
  session: { label: '会话', icon: MessageSquare },
  skill: { label: '技能', icon: Brain },
  custom: { label: '自定义', icon: File }
}

interface ParsedTrigger {
  trigger: '@' | '/' | '/arg'
  query: string
  replaceStart: number
  replaceEnd: number
  parentCommand?: string
}

function parseAtTrigger(content: string): ParsedTrigger | null {
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

function parseSlashTrigger(
  content: string,
  commands: SlashCommandItem[]
): ParsedTrigger | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('/')) return null
  const after = trimmed.slice(1)
  if (/^\([^)]+\)/.test(after)) return null

  const spaceIdx = after.indexOf(' ')
  if (spaceIdx > 0) {
    const cmdName = after.slice(0, spaceIdx).toLowerCase()
    const cmd = commands.find(
      (c) =>
        c.name.toLowerCase() === cmdName ||
        c.aliases?.some((a) => a.toLowerCase() === cmdName)
    )
    if (cmd && (cmd.subCommands?.length || cmd.argHints?.length)) {
      const argPart = after.slice(spaceIdx + 1)
      const argQuery = argPart.toLowerCase().trim()
      return {
        trigger: '/arg',
        query: argQuery,
        replaceStart: content.length - trimmed.length,
        replaceEnd: content.length,
        parentCommand: cmd.name
      }
    }
  }

  const query = (
    spaceIdx >= 0 ? after.slice(0, spaceIdx) : after
  ).toLowerCase()
  return {
    trigger: '/',
    query,
    replaceStart: content.length - trimmed.length,
    replaceEnd: content.length
  }
}

interface ArgCandidate {
  value: string
  label: string
  description?: string
  isSubCommand: boolean
}

/** 按资源类型分组后的扁平列表项（包含分组头和资源项） */
interface FlatGroupedItem {
  isGroupHeader: boolean
  typeKey?: string
  item?: ScopeRefItem
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
    return parseSlashTrigger(markdownContent, scopeSlashCommands) ?? null
  }, [markdownContent, scopeSlashCommands])

  const argCandidates = useMemo((): ArgCandidate[] => {
    if (!parsed || parsed.trigger !== '/arg' || !parsed.parentCommand) return []
    const cmd = scopeSlashCommands.find((c) => c.name === parsed.parentCommand)
    if (!cmd) return []
    const items: ArgCandidate[] = []
    if (cmd.subCommands?.length) {
      for (const sc of cmd.subCommands) {
        items.push({ value: sc.name, label: sc.name, description: sc.description, isSubCommand: true })
      }
    }
    if (cmd.argHints?.length) {
      for (const hint of cmd.argHints) {
        if (!items.some((i) => i.value === hint)) {
          items.push({ value: hint, label: hint, isSubCommand: false })
        }
      }
    }
    const q = parsed.query
    if (!q) return items.slice(0, 20)
    return items
      .filter(
        (i) =>
          i.value.toLowerCase().includes(q) ||
          (i.description && i.description.toLowerCase().includes(q))
      )
      .slice(0, 20)
  }, [parsed, scopeSlashCommands])

  const candidates = useMemo(() => {
    if (!parsed) return []
    if (parsed.trigger === '/arg') return argCandidates
    if (parsed.trigger === '@') {
      const q = parsed.query
      const filtered = !q
        ? scopeItems
        : scopeItems.filter(
            (item) =>
              itemToRefKey(item).includes(q) ||
              (TYPE_CONFIG[itemToRefKey(item)]?.label ?? '').includes(q) ||
              item.title.toLowerCase().includes(q) ||
              item.id.toLowerCase().includes(q)
          )
      return filtered.slice(0, 30)
    }
    const q = parsed.query
    const filtered = !q
      ? scopeSlashCommands
      : scopeSlashCommands.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
            c.description.toLowerCase().includes(q)
        )
    return filtered.slice(0, 15)
  }, [parsed, scopeItems, scopeSlashCommands, argCandidates])

  useEffect(() => {
    setSelectedIndex(0)
  }, [parsed?.trigger, parsed?.query, candidates.length])

  const isAt = parsed?.trigger === '@'
  const isArg = parsed?.trigger === '/arg'
  const visible = !!parsed && candidates.length > 0

  const selectItem = useCallback(
    (index: number) => {
      if (!parsed || index < 0 || index >= candidates.length) return
      const applyText = storeApi.getState().applyOverlayTextReplace

      if (isAt) {
        const item = candidates[index] as ScopeRefItem
        const typeKey = itemToRefKey(item)
        const refKey = item.id
        const markdown = `@(${typeKey}:${encodeFilePathForRef(refKey)})`
        const label = item.title.length > 30 ? item.title.slice(0, 30) + '...' : item.title

        storeApi.getState().addInputRef({
          type: typeKey as InputRef['type'],
          key: refKey,
          label,
          markdown
        })

        const applyChip = storeApi.getState().applyOverlayChipInsert
        if (applyChip) {
          applyChip(parsed.replaceStart, parsed.replaceEnd, typeKey, refKey, label, markdown)
        } else if (applyText) {
          applyText(parsed.replaceStart, parsed.replaceEnd, '')
        }
      } else if (isArg) {
        const arg = (candidates[index] as ArgCandidate).value
        const replacement = `/(${parsed.parentCommand} ${arg}) `
        if (applyText) {
          applyText(parsed.replaceStart, parsed.replaceEnd, replacement)
        } else if (editor) {
          const before = markdownContent.slice(0, parsed.replaceStart)
          const after = markdownContent.slice(parsed.replaceEnd)
          setDocument('markdown', before + replacement + after)
        }
      } else {
        const cmd = candidates[index] as SlashCommandItem
        const hasSubLevel = cmd.subCommands?.length || cmd.argHints?.length
        const replacement = hasSubLevel ? `/${cmd.name} ` : `/(${cmd.name})`
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
    [parsed, editor, candidates, isAt, isArg, markdownContent, setDocument, storeApi]
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
    const listRoot = container.querySelector('.mention-overlay-list')
    if (!listRoot) return
    const item =
      listRoot.querySelector(`.mention-overlay-item[data-candidate-index="${selectedIndex}"]`) ??
      listRoot.querySelectorAll('.mention-overlay-item')[selectedIndex]
    const el = item as HTMLElement | undefined
    if (el) {
      requestAnimationFrame(() => {
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

  // ─── @ 模式：分组渲染 ───

  const groupedAtView = useMemo(() => {
    if (!isAt) return null
    const items = candidates as ScopeRefItem[]
    const groups = new Map<string, ScopeRefItem[]>()
    for (const it of items) {
      const key = itemToRefKey(it)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(it)
    }

    let flatIndex = 0
    const sections: React.ReactNode[] = []

    for (const [typeKey, groupItems] of groups) {
      const cfg = TYPE_CONFIG[typeKey]
      const Icon = cfg?.icon ?? FileText
      const label = cfg?.label ?? typeKey
      const accent = cfg?.accent ?? 'var(--ant-color-text-secondary)'

      sections.push(
        <div key={`hdr-${typeKey}`} className="mention-overlay-group-header">
          <Icon size={12} style={{ color: accent, flexShrink: 0 }} />
          <span>{label}</span>
          <span className="mention-overlay-group-count">{groupItems.length}</span>
        </div>
      )

      for (const item of groupItems) {
        const idx = flatIndex++
        const isActive = selectedIndex === idx
        const title = item.title.length > 36 ? item.title.slice(0, 36) + '...' : item.title
        const idShort = item.id.length > 8 ? item.id.slice(0, 8) : item.id
        const statusText = item.groupOrStatus
        sections.push(
          <div
            key={`${typeKey}:${item.id}`}
            className={`mention-overlay-item${isActive ? ' mention-overlay-item--active' : ''}`}
            role="option"
            aria-selected={isActive}
            onClick={() => selectItem(idx)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <Icon size={14} className="mention-overlay-item__icon" style={{ color: accent }} />
            <div className="mention-overlay-item__body">
              <span className="mention-overlay-item__title">{title}</span>
              <span className="mention-overlay-item__meta">
                {idShort}
                {statusText && (
                  <span className="mention-overlay-item__status">{statusText}</span>
                )}
              </span>
            </div>
          </div>
        )
      }
    }

    return sections
  }, [isAt, candidates, selectedIndex, selectItem])

  // ─── / 模式（非 /arg）：按 category 分组展示 ───

  const groupedSlashView = useMemo(() => {
    if (isAt || isArg || candidates.length === 0) return null
    const slashCandidates = candidates as SlashCommandItem[]
    const byCategory = new Map<string | undefined, Array<{ cmd: SlashCommandItem; index: number }>>()
    slashCandidates.forEach((cmd, index) => {
      const cat = cmd.category || undefined
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push({ cmd, index })
    })
    const sections: React.ReactNode[] = []
    const orderedKeys = [
      ...SLASH_CATEGORY_ORDER,
      ...Array.from(byCategory.keys()).filter((k) => k !== undefined && !SLASH_CATEGORY_ORDER.includes(k)),
      undefined
    ]
    for (const catKey of orderedKeys) {
      const group = byCategory.get(catKey)
      if (!group?.length) continue
      const label = catKey ? (SLASH_CATEGORY_CONFIG[catKey]?.label ?? catKey) : '其他'
      const Icon = catKey && SLASH_CATEGORY_CONFIG[catKey]?.icon ? SLASH_CATEGORY_CONFIG[catKey].icon : FileText
      const accent = 'var(--ant-color-text-secondary)'
      sections.push(
        <div key={`cat-${catKey ?? '_'}`} className="mention-overlay-group-header">
          <Icon size={12} style={{ color: accent, flexShrink: 0 }} />
          <span>{label}</span>
          <span className="mention-overlay-group-count">{group.length}</span>
        </div>
      )
      for (const { cmd, index } of group) {
        const isActive = selectedIndex === index
        sections.push(
          <div
            key={`${cmd.name}-${index}`}
            className={`mention-overlay-item${isActive ? ' mention-overlay-item--active' : ''}`}
            role="option"
            aria-selected={isActive}
            data-candidate-index={index}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <Icon size={14} className="mention-overlay-item__icon" style={{ color: accent }} />
            <div className="mention-overlay-item__body">
              <span className="mention-overlay-item__title">/{cmd.name}</span>
              <span className="mention-slash-desc mention-overlay-item__meta">
                {!cmd.builtin && (
                  <Tag style={{ fontSize: 10, marginRight: 4 }}>
                    {cmd.mode === 'prompt' ? 'prompt' : 'action'}
                  </Tag>
                )}
                {cmd.subCommands?.length ? (
                  <Tag style={{ fontSize: 10, marginRight: 4 }}>有子命令</Tag>
                ) : null}
                {cmd.description}
              </span>
            </div>
          </div>
        )
      }
    }
    return sections
  }, [isAt, isArg, candidates, selectedIndex, selectItem])

  // ─── /arg 模式：使用 AccentList ───

  const listItems = useMemo(() => {
    if (isAt) return []
    if (!isArg) return []
    return candidates.map((c, i) => {
      const isActive = selectedIndex === i
      const argItem = c as ArgCandidate
      return {
        key: argItem.value,
        title: argItem.label,
        addon: argItem.description ? (
          <span className="mention-slash-desc">
            {argItem.isSubCommand && (
              <Tag style={{ fontSize: 10, marginRight: 4 }}>子命令</Tag>
            )}
            {argItem.description}
          </span>
        ) : argItem.isSubCommand ? (
          <Tag style={{ fontSize: 10 }}>子命令</Tag>
        ) : null,
        active: isActive,
        onClick: () => selectItem(i),
        onMouseEnter: () => setSelectedIndex(i)
      }
    })
  }, [candidates, isAt, isArg, selectedIndex, selectItem])

  const activeKey = useMemo(() => {
    if (candidates.length === 0 || selectedIndex < 0 || selectedIndex >= candidates.length)
      return undefined
    const c = candidates[selectedIndex]
    if (isAt) return `${itemToRefKey(c as ScopeRefItem)}:${(c as ScopeRefItem).id}`
    if (isArg) return (c as ArgCandidate).value
    return (c as SlashCommandItem).name
  }, [candidates, isAt, isArg, selectedIndex])

  if (!visible) return null

  return (
    <div
      ref={overlayRef}
      className="mention-slash-overlay"
      role="listbox"
      tabIndex={-1}
      aria-label={isAt ? '引用候选' : isArg ? '参数候选' : '命令候选'}
    >
      {isArg && parsed?.parentCommand && (
        <div className="mention-overlay-breadcrumb">
          /{parsed.parentCommand} ...
        </div>
      )}
      {isAt ? (
        <div className="mention-overlay-list">{groupedAtView}</div>
      ) : isArg ? (
        <AccentList activeKey={activeKey} items={listItems} />
      ) : (
        <div className="mention-overlay-list">{groupedSlashView}</div>
      )}
    </div>
  )
})

MentionSlashOverlay.displayName = 'MentionSlashOverlay'

export default MentionSlashOverlay
