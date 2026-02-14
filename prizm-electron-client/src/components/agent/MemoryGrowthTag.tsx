/**
 * 单轮对话记忆增长标签 - 展示在 assistant 消息旁，可点击查看详情
 */
import { useState, useCallback } from 'react'
import { Popover, Flexbox, Text } from '@lobehub/ui'
import { Brain } from 'lucide-react'
import type { RoundMemoryGrowth } from '@prizm/shared'

const TYPE_LABELS: Record<string, string> = {
  episodic_memory: '情景',
  event_log: '事件',
  foresight: '预见',
  profile: '画像'
}

interface MemoryGrowthTagProps {
  messageId: string
  memoryGrowth?: RoundMemoryGrowth | null
  onFetch?: (messageId: string) => Promise<RoundMemoryGrowth | null>
  scope?: string
}

export function MemoryGrowthTag({ messageId, memoryGrowth, onFetch, scope }: MemoryGrowthTagProps) {
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState<RoundMemoryGrowth | null | undefined>(memoryGrowth)
  const [open, setOpen] = useState(false)

  const data = fetched ?? memoryGrowth
  const count = data?.count ?? 0
  const hasData = count > 0 || (data === null && fetched !== undefined)

  const handleOpen = useCallback(async () => {
    if (fetched !== undefined) {
      setOpen(true)
      return
    }
    if (!onFetch) return
    setLoading(true)
    try {
      const result = await onFetch(messageId)
      setFetched(result)
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [messageId, onFetch, fetched])

  if (!messageId) return null

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={
        data && data.count > 0 ? (
          <div style={{ padding: 12, maxWidth: 360 }}>
            <Text type="secondary" fontSize={12} style={{ marginBottom: 8 }}>
              本轮新增 {data.count} 条记忆
            </Text>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {data.memories.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: '6px 8px',
                    marginBottom: 4,
                    background: 'var(--ant-color-fill-quaternary)',
                    borderRadius: 6,
                    fontSize: 12
                  }}
                >
                  <Text type="secondary" fontSize={11}>
                    {TYPE_LABELS[m.memory_type ?? ''] ?? m.memory_type}
                  </Text>
                  <div style={{ marginTop: 2 }}>
                    {m.memory?.slice(0, 120)}
                    {m.memory && m.memory.length > 120 ? '...' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : data && data.count === 0 ? (
          <div style={{ padding: 12 }}>本轮未产生新记忆</div>
        ) : loading ? (
          <div style={{ padding: 12 }}>加载中...</div>
        ) : null
      }
    >
      <button
        type="button"
        className="memory-growth-tag"
        onClick={handleOpen}
        disabled={loading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          marginLeft: 4,
          fontSize: 11,
          color: 'var(--ant-color-text-tertiary)',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'wait' : 'pointer'
        }}
      >
        <Brain size={12} />
        <span>记忆</span>
        {count > 0 && <span>+{count}</span>}
      </button>
    </Popover>
  )
}
