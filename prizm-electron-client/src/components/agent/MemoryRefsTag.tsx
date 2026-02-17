/**
 * 解耦的双向记忆引用标签 - 展示在 assistant 消息旁
 * 显示 [上下文 N] [新增 M]，点击懒加载记忆详情，按层分组展示
 */
import { useState, useCallback, useMemo } from 'react'
import { Popover, Text } from '@lobehub/ui'
import { Brain, Sparkles, User, Layers, MessageSquare } from 'lucide-react'
import type { MemoryRefs, MemoryIdsByLayer, MemoryItem } from '@prizm/shared'

/** 纯记忆类型标签 */
const TYPE_LABELS: Record<string, string> = {
  narrative: '叙事',
  event_log: '事件',
  foresight: '前瞻',
  document: '文档',
  profile: '画像'
}

/** 文档子类型标签 */
const DOC_SUB_TYPE_LABELS: Record<string, string> = {
  overview: '总览',
  fact: '事实',
  migration: '变更'
}

const TYPE_COLORS: Record<string, string> = {
  narrative: '#1677ff',
  foresight: '#722ed1',
  event_log: '#13c2c2',
  document: '#52c41a',
  profile: '#faad14'
}

const LAYER_CONFIG = {
  user: { label: 'User', icon: User, color: '#faad14' },
  scope: { label: 'Scope', icon: Layers, color: '#1677ff' },
  session: { label: 'Session', icon: MessageSquare, color: '#13c2c2' }
} as const

type LayerKey = keyof typeof LAYER_CONFIG

function countLayer(layer: MemoryIdsByLayer): number {
  return (layer.user?.length ?? 0) + (layer.scope?.length ?? 0) + (layer.session?.length ?? 0)
}

interface MemoryRefsTagProps {
  memoryRefs?: MemoryRefs | null
  onResolve?: (byLayer: MemoryIdsByLayer) => Promise<Record<string, MemoryItem | null>>
  scope?: string
}

/** 按 memory_type + 来源（叙事/文档）分组后的结构 */
interface TypeGroup {
  key: string
  label: string
  color: string
  items: { id: string; mem: MemoryItem }[]
  deleted: string[]
}

/**
 * 将一组记忆 ID 按 memory_type 分类，document 类型进一步按 sub_type 细分
 */
function groupByTypeAndSource(
  ids: string[],
  resolved: Record<string, MemoryItem | null>,
  _layerKey: LayerKey
): TypeGroup[] {
  const groups: Record<string, TypeGroup> = {}
  const deleted: string[] = []

  for (const id of ids) {
    const mem = resolved[id]
    if (mem === null) {
      deleted.push(id)
      continue
    }
    if (!mem) continue

    const type = mem.memory_type ?? 'unknown'
    const subType = (mem as any).sub_type as string | undefined
    const isDoc = type === 'document'
    const key = isDoc && subType ? `document:${subType}` : type
    if (!groups[key]) {
      groups[key] = {
        key,
        label:
          isDoc && subType
            ? `文档${DOC_SUB_TYPE_LABELS[subType] ?? subType}`
            : TYPE_LABELS[type] ?? type,
        color: TYPE_COLORS[type] ?? 'var(--ant-color-text-quaternary)',
        items: [],
        deleted: []
      }
    }
    groups[key].items.push({ id, mem })
  }

  // 固定排序
  const ORDER = [
    'profile',
    'narrative',
    'foresight',
    'document:overview',
    'document:fact',
    'document:migration',
    'document',
    'event_log'
  ]
  const sorted = ORDER.filter((k) => groups[k]).map((k) => groups[k])
  const rest = Object.keys(groups)
    .filter((k) => !ORDER.includes(k))
    .map((k) => groups[k])
  const all = [...sorted, ...rest]

  if (deleted.length > 0) {
    if (all.length > 0) {
      all[0].deleted = deleted
    } else {
      all.push({
        key: '_deleted',
        label: '已删除',
        color: 'var(--ant-color-text-quaternary)',
        items: [],
        deleted
      })
    }
  }
  return all
}

/** 按层分组、内部按类型细分的记忆列表 */
function LayerGroup({
  layerKey,
  ids,
  resolved
}: {
  layerKey: LayerKey
  ids: string[]
  resolved: Record<string, MemoryItem | null>
}) {
  if (ids.length === 0) return null
  const config = LAYER_CONFIG[layerKey]
  const Icon = config.icon
  const typeGroups = groupByTypeAndSource(ids, resolved, layerKey)

  return (
    <div style={{ marginBottom: 10 }}>
      {/* 层级标题 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 6,
          paddingBottom: 3,
          borderBottom: `1px solid var(--ant-color-border-secondary)`
        }}
      >
        <Icon size={11} style={{ color: config.color }} />
        <Text
          type="secondary"
          style={{ fontSize: 11, fontWeight: 600, color: config.color, letterSpacing: 0.3 }}
        >
          {config.label}
        </Text>
        <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>
          {ids.length}
        </Text>
      </div>

      {/* 按类型+来源分组 */}
      {typeGroups.map((group) => (
        <div key={group.key} style={{ marginBottom: 6 }}>
          {/* 类型子标题 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 2,
              paddingLeft: 4
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: group.color,
                flexShrink: 0
              }}
            />
            <Text style={{ fontSize: 10, color: group.color, fontWeight: 500 }}>{group.label}</Text>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {group.items.length}
            </Text>
          </div>

          {/* 已删除项 */}
          {group.deleted.map((id) => (
            <div
              key={id}
              style={{
                padding: '3px 8px',
                marginBottom: 2,
                marginLeft: 10,
                background: 'var(--ant-color-fill-quaternary)',
                borderRadius: 5,
                fontSize: 11,
                color: 'var(--ant-color-text-quaternary)',
                fontStyle: 'italic'
              }}
            >
              已删除
            </div>
          ))}

          {/* 记忆内容 */}
          {group.items.map(({ id, mem }) => (
            <div
              key={id}
              style={{
                padding: '4px 8px',
                marginBottom: 2,
                marginLeft: 10,
                background: 'var(--ant-color-fill-quaternary)',
                borderRadius: 5,
                fontSize: 12,
                color: 'var(--ant-color-text)',
                lineHeight: 1.4
              }}
            >
              {mem.memory?.slice(0, 100)}
              {mem.memory && mem.memory.length > 100 ? '...' : ''}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MemoryRefsPopoverButton({
  icon,
  label,
  count,
  byLayer,
  onResolve,
  title
}: {
  icon: React.ReactNode
  label: string
  count: number
  byLayer: MemoryIdsByLayer
  onResolve?: MemoryRefsTagProps['onResolve']
  title: string
}) {
  const [resolved, setResolved] = useState<Record<string, MemoryItem | null> | null>(null)
  const [loading, setLoading] = useState(false)

  const handleOpen = useCallback(
    async (open: boolean) => {
      if (open && !resolved && onResolve) {
        setLoading(true)
        try {
          const result = await onResolve(byLayer)
          setResolved(result)
        } finally {
          setLoading(false)
        }
      }
    },
    [byLayer, onResolve, resolved]
  )

  /** 按层统计 */
  const layerCounts = useMemo(
    () => ({
      user: byLayer.user?.length ?? 0,
      scope: byLayer.scope?.length ?? 0,
      session: byLayer.session?.length ?? 0
    }),
    [byLayer]
  )

  return (
    <Popover
      onOpenChange={handleOpen}
      content={
        <div style={{ padding: 10, maxWidth: 400, minWidth: 260 }}>
          {/* 标题 + 层统计 */}
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
              {title}
            </Text>
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 4,
                fontSize: 11,
                color: 'var(--ant-color-text-tertiary)'
              }}
            >
              {layerCounts.user > 0 && (
                <span style={{ color: LAYER_CONFIG.user.color }}>User {layerCounts.user}</span>
              )}
              {layerCounts.scope > 0 && (
                <span style={{ color: LAYER_CONFIG.scope.color }}>Scope {layerCounts.scope}</span>
              )}
              {layerCounts.session > 0 && (
                <span style={{ color: LAYER_CONFIG.session.color }}>
                  Session {layerCounts.session}
                </span>
              )}
            </div>
          </div>

          {loading && !resolved && (
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-quaternary)', padding: 8 }}>
              加载中...
            </div>
          )}
          {resolved && (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <LayerGroup layerKey="user" ids={byLayer.user ?? []} resolved={resolved} />
              <LayerGroup layerKey="scope" ids={byLayer.scope ?? []} resolved={resolved} />
              <LayerGroup layerKey="session" ids={byLayer.session ?? []} resolved={resolved} />
            </div>
          )}
        </div>
      }
    >
      <button
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 7px',
          fontSize: 11,
          color: 'var(--ant-color-text-tertiary)',
          background: 'var(--ant-color-fill-quaternary)',
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--ant-color-fill-tertiary)'
          e.currentTarget.style.color = 'var(--ant-color-text-secondary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--ant-color-fill-quaternary)'
          e.currentTarget.style.color = 'var(--ant-color-text-tertiary)'
        }}
      >
        {icon}
        <span>
          {label} {count}
        </span>
      </button>
    </Popover>
  )
}

export function MemoryRefsTag({ memoryRefs, onResolve }: MemoryRefsTagProps) {
  if (!memoryRefs) return null

  const injectedCount = countLayer(memoryRefs.injected)
  const createdCount = countLayer(memoryRefs.created)
  if (injectedCount === 0 && createdCount === 0) return null

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 4,
        fontSize: 11,
        color: 'var(--ant-color-text-tertiary)'
      }}
    >
      {injectedCount > 0 && (
        <MemoryRefsPopoverButton
          icon={<Brain size={11} />}
          label="上下文"
          count={injectedCount}
          byLayer={memoryRefs.injected}
          onResolve={onResolve}
          title="注入的上下文记忆"
        />
      )}
      {createdCount > 0 && (
        <MemoryRefsPopoverButton
          icon={<Sparkles size={11} />}
          label="新增"
          count={createdCount}
          byLayer={memoryRefs.created}
          onResolve={onResolve}
          title="本轮新增记忆"
        />
      )}
    </span>
  )
}
