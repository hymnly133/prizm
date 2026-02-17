/**
 * 侧边栏记忆面板 — 替代仅显示计数的方式
 * 展示最近引用记忆、三层分区、可打开完整 MemoryInspector
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Popover, Text } from '@lobehub/ui'
import { Segmented, Empty } from 'antd'
import { Brain, Layers, Loader2, MessageSquare, RefreshCw, Search, User } from 'lucide-react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import type { MemoryItem } from '@prizm/client-core'
import { createStyles } from 'antd-style'
import { fadeUp, EASE_SMOOTH } from '../../theme/motionPresets'

const LAYER_CONFIG = {
  all: { label: '全部', icon: Brain },
  user: { label: 'User', icon: User, color: '#faad14' },
  scope: { label: 'Scope', icon: Layers, color: '#1677ff' },
  session: { label: 'Session', icon: MessageSquare, color: '#13c2c2' }
} as const

type LayerFilter = keyof typeof LAYER_CONFIG

const TYPE_LABELS: Record<string, string> = {
  narrative: '叙事',
  foresight: '前瞻',
  document: '文档',
  event_log: '事件',
  profile: '画像'
}

const TYPE_COLORS: Record<string, string> = {
  narrative: '#1677ff',
  foresight: '#722ed1',
  document: '#52c41a',
  event_log: '#13c2c2',
  profile: '#faad14'
}

type MemoryItemWithLayer = MemoryItem & { memory_layer?: string; group_id?: string | null }

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  `,
  title: css`
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${token.colorTextSecondary};
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  refreshBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorPrimary};
    }
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 280px;
    overflow-y: auto;
  `,
  memoryItem: css`
    padding: 8px 10px;
    border-radius: 8px;
    background: ${token.colorFillQuaternary};
    transition: background 0.15s;
    cursor: default;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  memoryText: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorText};
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  `,
  memoryMeta: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: 10px;
    color: ${token.colorTextQuaternary};
  `,
  typeDot: css`
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  viewAllBtn: css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    color: ${token.colorTextQuaternary};
    font-size: 12px;
    gap: 4px;
  `,
  countBadge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: ${token.colorFillSecondary};
    font-size: 10px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    font-variant-numeric: tabular-nums;
  `
}))

interface MemorySidebarPanelProps {
  memoryEnabled: boolean
  userMemoryCount: number
  scopeMemoryCount: number
  memoryCountsLoading: boolean
  onOpenInspector?: () => void
}

export function MemorySidebarPanel({
  memoryEnabled,
  userMemoryCount,
  scopeMemoryCount,
  memoryCountsLoading,
  onOpenInspector
}: MemorySidebarPanelProps) {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const http = manager?.getHttpClient()
  const [memories, setMemories] = useState<MemoryItemWithLayer[]>([])
  const [loading, setLoading] = useState(false)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')

  const loadRecentMemories = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getMemories(currentScope)
      if (res.enabled) {
        setMemories(res.memories?.slice(0, 20) ?? [])
      }
    } catch {
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [http, currentScope])

  useEffect(() => {
    if (memoryEnabled) void loadRecentMemories()
  }, [memoryEnabled, loadRecentMemories])

  const filtered = memories.filter((m) => {
    if (layerFilter === 'all') return true
    return m.memory_layer === layerFilter
  })

  if (!memoryEnabled) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.title}>
            <Brain size={14} />
            记忆
          </span>
        </div>
        <div className={styles.empty}>
          <Brain size={20} style={{ opacity: 0.3 }} />
          <span>记忆模块未启用</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <Brain size={14} />
          记忆
          {!memoryCountsLoading && (
            <span className={styles.countBadge}>{userMemoryCount + scopeMemoryCount}</span>
          )}
        </span>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => void loadRecentMemories()}
          disabled={loading}
          title="刷新"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Layer filter */}
      <Segmented
        size="small"
        block
        value={layerFilter}
        onChange={(v) => setLayerFilter(v as LayerFilter)}
        options={[
          { label: '全部', value: 'all' },
          { label: `User ${userMemoryCount}`, value: 'user' },
          { label: `Scope ${scopeMemoryCount}`, value: 'scope' }
        ]}
      />

      {/* Memory list */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>
            <Loader2 size={14} className="spinning" />
            <span>加载中</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span>暂无记忆</span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.slice(0, 8).map((mem, i) => (
              <motion.div
                key={mem.id}
                className={styles.memoryItem}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{
                  duration: 0.2,
                  delay: i * 0.03,
                  ease: EASE_SMOOTH
                }}
              >
                <div className={styles.memoryText}>{mem.memory}</div>
                <div className={styles.memoryMeta}>
                  {mem.memory_type && (
                    <>
                      <span
                        className={styles.typeDot}
                        style={{
                          background: TYPE_COLORS[mem.memory_type] ?? '#94a3b8'
                        }}
                      />
                      <span>{TYPE_LABELS[mem.memory_type] ?? mem.memory_type}</span>
                    </>
                  )}
                  {mem.ref_count != null && mem.ref_count > 0 && (
                    <span>引用 {mem.ref_count}次</span>
                  )}
                  {mem.created_at && <span>{new Date(mem.created_at).toLocaleDateString()}</span>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Open full inspector */}
      {onOpenInspector && (
        <button type="button" className={styles.viewAllBtn} onClick={onOpenInspector}>
          <Search size={12} />
          查看/管理全部记忆
        </button>
      )}
    </div>
  )
}
