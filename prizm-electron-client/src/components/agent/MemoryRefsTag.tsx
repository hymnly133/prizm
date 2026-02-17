/**
 * 解耦的双向记忆引用标签 - 展示在 assistant 消息旁
 * 显示 [上下文 N] [新增 M]，点击懒加载记忆详情
 */
import { useState, useCallback, useMemo } from 'react'
import { Popover, Text } from '@lobehub/ui'
import { Brain, Sparkles } from 'lucide-react'
import type { MemoryRefs, MemoryIdsByLayer, MemoryItem } from '@prizm/shared'

const TYPE_LABELS: Record<string, string> = {
  episodic_memory: '情景',
  event_log: '事件',
  foresight: '预见',
  profile: '画像',
  group_profile: '群组画像'
}

function countLayer(layer: MemoryIdsByLayer): number {
  return (layer.user?.length ?? 0) + (layer.scope?.length ?? 0) + (layer.session?.length ?? 0)
}

interface MemoryRefsTagProps {
  memoryRefs?: MemoryRefs | null
  onResolve?: (byLayer: MemoryIdsByLayer) => Promise<Record<string, MemoryItem | null>>
  scope?: string
}

function MemoryListPopover({
  title,
  byLayer,
  onResolve
}: {
  title: string
  byLayer: MemoryIdsByLayer
  onResolve?: MemoryRefsTagProps['onResolve']
}) {
  const [resolved, setResolved] = useState<Record<string, MemoryItem | null> | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLoad = useCallback(async () => {
    if (resolved || !onResolve) return
    setLoading(true)
    try {
      const result = await onResolve(byLayer)
      setResolved(result)
    } finally {
      setLoading(false)
    }
  }, [byLayer, onResolve, resolved])

  const allIds = useMemo(
    () => [...(byLayer.user ?? []), ...(byLayer.scope ?? []), ...(byLayer.session ?? [])],
    [byLayer]
  )
  const count = allIds.length

  if (count === 0) return null

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) handleLoad()
      }}
      content={
        <div style={{ padding: 12, maxWidth: 380 }}>
          <Text type="secondary" fontSize={12} style={{ marginBottom: 8, display: 'block' }}>
            {title} ({count} 条)
          </Text>
          {loading && !resolved && (
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-quaternary)' }}>加载中...</div>
          )}
          {resolved && (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {allIds.map((id) => {
                const mem = resolved[id]
                if (mem === null) {
                  return (
                    <div
                      key={id}
                      style={{
                        padding: '4px 8px',
                        marginBottom: 3,
                        background: 'var(--ant-color-fill-quaternary)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--ant-color-text-quaternary)',
                        fontStyle: 'italic'
                      }}
                    >
                      该记忆已删除
                    </div>
                  )
                }
                if (!mem) return null
                return (
                  <div
                    key={id}
                    style={{
                      padding: '6px 8px',
                      marginBottom: 3,
                      background: 'var(--ant-color-fill-quaternary)',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                  >
                    <Text type="secondary" fontSize={11}>
                      {TYPE_LABELS[mem.memory_type ?? ''] ?? mem.memory_type}
                    </Text>
                    <div style={{ marginTop: 2 }}>
                      {mem.memory?.slice(0, 120)}
                      {mem.memory && mem.memory.length > 120 ? '...' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      }
    >
      <span>
        {title.includes('上下文') ? '上下文' : '新增'} {count}
      </span>
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
        gap: 6,
        marginLeft: 4,
        fontSize: 11,
        color: 'var(--ant-color-text-tertiary)'
      }}
    >
      {injectedCount > 0 && (
        <MemoryRefsPopoverButton
          icon={<Brain size={12} />}
          label="上下文"
          count={injectedCount}
          byLayer={memoryRefs.injected}
          onResolve={onResolve}
          title="注入的上下文记忆"
        />
      )}
      {createdCount > 0 && (
        <MemoryRefsPopoverButton
          icon={<Sparkles size={12} />}
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

  const allIds = useMemo(
    () => [...(byLayer.user ?? []), ...(byLayer.scope ?? []), ...(byLayer.session ?? [])],
    [byLayer]
  )

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

  return (
    <Popover
      onOpenChange={handleOpen}
      content={
        <div style={{ padding: 12, maxWidth: 380 }}>
          <Text type="secondary" fontSize={12} style={{ marginBottom: 8, display: 'block' }}>
            {title} ({count} 条)
          </Text>
          {loading && !resolved && (
            <div style={{ fontSize: 12, color: 'var(--ant-color-text-quaternary)' }}>加载中...</div>
          )}
          {resolved && (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {allIds.map((id) => {
                const mem = resolved[id]
                if (mem === null) {
                  return (
                    <div
                      key={id}
                      style={{
                        padding: '4px 8px',
                        marginBottom: 3,
                        background: 'var(--ant-color-fill-quaternary)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--ant-color-text-quaternary)',
                        fontStyle: 'italic'
                      }}
                    >
                      该记忆已删除
                    </div>
                  )
                }
                if (!mem) return null
                return (
                  <div
                    key={id}
                    style={{
                      padding: '6px 8px',
                      marginBottom: 3,
                      background: 'var(--ant-color-fill-quaternary)',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                  >
                    <Text type="secondary" fontSize={11}>
                      {TYPE_LABELS[mem.memory_type ?? ''] ?? mem.memory_type}
                    </Text>
                    <div style={{ marginTop: 2 }}>
                      {mem.memory?.slice(0, 120)}
                      {mem.memory && mem.memory.length > 120 ? '...' : ''}
                    </div>
                  </div>
                )
              })}
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
          padding: '2px 6px',
          fontSize: 11,
          color: 'var(--ant-color-text-tertiary)',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer'
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
