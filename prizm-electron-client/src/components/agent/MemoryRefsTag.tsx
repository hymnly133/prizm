/**
 * 解耦的双向记忆引用标签 - 展示在 assistant 消息旁
 * 显示 [上下文 N] [新增 M]，点击懒加载记忆详情，按层分组展示
 */
import { useState, useCallback, useMemo } from 'react'
import { Popover, Text } from '@lobehub/ui'
import { createStyles } from 'antd-style'
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

const useStyles = createStyles(({ css, token }) => ({
  layerGroup: css`
    margin-bottom: 10px;
  `,
  layerHeader: css`
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  layerLabel: css`
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
  `,
  layerCount: css`
    font-size: 10px;
    margin-left: auto;
  `,
  typeGroup: css`
    margin-bottom: 6px;
  `,
  typeHeader: css`
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
    padding-left: 4px;
  `,
  typeDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  typeLabel: css`
    font-size: 10px;
    font-weight: 500;
  `,
  typeCount: css`
    font-size: 10px;
  `,
  memoryItem: css`
    padding: 4px 8px;
    margin-bottom: 2px;
    margin-left: 10px;
    background: ${token.colorFillQuaternary};
    border-radius: 5px;
    font-size: 12px;
    color: ${token.colorText};
    line-height: 1.4;
  `,
  deletedItem: css`
    padding: 3px 8px;
    margin-bottom: 2px;
    margin-left: 10px;
    background: ${token.colorFillQuaternary};
    border-radius: 5px;
    font-size: 11px;
    color: ${token.colorTextQuaternary};
    font-style: italic;
  `,
  popoverContent: css`
    padding: 10px;
    max-width: 400px;
    min-width: 260px;
  `,
  popoverTitle: css`
    margin-bottom: 8px;
  `,
  popoverTitleText: css`
    font-size: 12px;
    font-weight: 600;
    display: block;
  `,
  popoverLayerStats: css`
    display: flex;
    gap: 8px;
    margin-top: 4px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  loadingText: css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
    padding: 8px;
  `,
  resolvedList: css`
    max-height: 300px;
    overflow: auto;
  `,
  popoverButton: css`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    background: ${token.colorFillQuaternary};
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorTextSecondary};
    }
  `,
  rootTag: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `
}))

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
  const { styles } = useStyles()
  if (ids.length === 0) return null
  const config = LAYER_CONFIG[layerKey]
  const Icon = config.icon
  const typeGroups = groupByTypeAndSource(ids, resolved, layerKey)

  return (
    <div className={styles.layerGroup}>
      <div className={styles.layerHeader}>
        <Icon size={11} style={{ color: config.color }} />
        <Text type="secondary" className={styles.layerLabel} style={{ color: config.color }}>
          {config.label}
        </Text>
        <Text type="secondary" className={styles.layerCount}>
          {ids.length}
        </Text>
      </div>

      {typeGroups.map((group) => (
        <div key={group.key} className={styles.typeGroup}>
          <div className={styles.typeHeader}>
            <span className={styles.typeDot} style={{ background: group.color }} />
            <Text className={styles.typeLabel} style={{ color: group.color }}>
              {group.label}
            </Text>
            <Text type="secondary" className={styles.typeCount}>
              {group.items.length}
            </Text>
          </div>

          {group.deleted.map((id) => (
            <div key={id} className={styles.deletedItem}>
              已删除
            </div>
          ))}

          {group.items.map(({ id, mem }) => (
            <div key={id} className={styles.memoryItem}>
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
  const { styles } = useStyles()
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
        <div className={styles.popoverContent}>
          <div className={styles.popoverTitle}>
            <Text type="secondary" className={styles.popoverTitleText}>
              {title}
            </Text>
            <div className={styles.popoverLayerStats}>
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

          {loading && !resolved && <div className={styles.loadingText}>加载中...</div>}
          {resolved && (
            <div className={styles.resolvedList}>
              <LayerGroup layerKey="user" ids={byLayer.user ?? []} resolved={resolved} />
              <LayerGroup layerKey="scope" ids={byLayer.scope ?? []} resolved={resolved} />
              <LayerGroup layerKey="session" ids={byLayer.session ?? []} resolved={resolved} />
            </div>
          )}
        </div>
      }
    >
      <button type="button" className={styles.popoverButton}>
        {icon}
        <span>
          {label} {count}
        </span>
      </button>
    </Popover>
  )
}

export function MemoryRefsTag({ memoryRefs, onResolve }: MemoryRefsTagProps) {
  const { styles } = useStyles()
  if (!memoryRefs) return null

  const injectedCount = countLayer(memoryRefs.injected)
  const createdCount = countLayer(memoryRefs.created)
  if (injectedCount === 0 && createdCount === 0) return null

  return (
    <span className={styles.rootTag}>
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
