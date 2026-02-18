/**
 * 侧边栏记忆面板 — 替代仅显示计数的方式
 * 展示最近引用记忆、三层分区、可打开完整 MemoryInspector
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Popover, Text } from '@lobehub/ui'
import { Segmented } from '../ui/Segmented'
import { Brain, ExternalLink, FileText, Layers, MessageSquare, Search, User } from 'lucide-react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import { useNavigation } from '../../context/NavigationContext'
import type { MemoryItem } from '@prizm/client-core'
import { createStyles } from 'antd-style'
import { fadeUp, EASE_SMOOTH } from '../../theme/motionPresets'
import { RefreshIconButton } from '../ui/RefreshIconButton'
import { EmptyState } from '../ui/EmptyState'
import { LoadingPlaceholder } from '../ui/LoadingPlaceholder'

const LAYER_CONFIG = {
  all: { label: '全部', icon: Brain },
  user: { label: 'User', icon: User, color: '#faad14' },
  scope: { label: 'Scope', icon: Layers, color: '#1677ff' },
  document: { label: '文档', icon: FileText, color: '#52c41a' },
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
  sessionMemoryCount: number
  documentMemoryCount: number
  memoryByType?: Record<string, number>
  memoryCountsLoading: boolean
  onOpenInspector?: () => void
}

export function MemorySidebarPanel({
  memoryEnabled,
  userMemoryCount,
  scopeMemoryCount,
  sessionMemoryCount,
  documentMemoryCount,
  memoryByType,
  memoryCountsLoading,
  onOpenInspector
}: MemorySidebarPanelProps) {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { navigateToAgentMessage } = useNavigation()
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
    if (layerFilter === 'document') return m.memory_type === 'document' && m.memory_layer === 'scope'
    if (layerFilter === 'scope') return m.memory_layer === 'scope' && m.memory_type !== 'document'
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
        <EmptyState description="记忆模块未启用" />
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
            <span className={styles.countBadge}>
              {userMemoryCount + scopeMemoryCount + documentMemoryCount + sessionMemoryCount}
            </span>
          )}
        </span>
        <RefreshIconButton
          onClick={() => void loadRecentMemories()}
          disabled={loading}
          title="刷新"
          size={11}
        />
      </div>

      {/* Layer filter + per-type summary */}
      <Segmented
        size="small"
        block
        value={layerFilter}
        onChange={(v) => setLayerFilter(v as LayerFilter)}
        options={[
          { label: '全部', value: 'all' },
          { label: `User ${userMemoryCount}`, value: 'user' },
          { label: `Scope ${scopeMemoryCount}`, value: 'scope' },
          { label: `文档 ${documentMemoryCount}`, value: 'document' },
          { label: `Session ${sessionMemoryCount}`, value: 'session' }
        ]}
      />
      {memoryByType && !memoryCountsLoading && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 11,
            color: 'var(--ant-color-text-tertiary)'
          }}
        >
          {memoryByType.profile > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TYPE_COLORS.profile
                }}
              />
              画像 {memoryByType.profile}
            </span>
          )}
          {memoryByType.narrative > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TYPE_COLORS.narrative
                }}
              />
              叙事 {memoryByType.narrative}
            </span>
          )}
          {memoryByType.foresight > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TYPE_COLORS.foresight
                }}
              />
              前瞻 {memoryByType.foresight}
            </span>
          )}
          {memoryByType.document > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TYPE_COLORS.document
                }}
              />
              文档 {memoryByType.document}
            </span>
          )}
          {memoryByType.event_log > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: TYPE_COLORS.event_log
                }}
              />
              事件 {memoryByType.event_log}
            </span>
          )}
        </div>
      )}

      {/* Memory list */}
      <div className={styles.list}>
        {loading ? (
          <LoadingPlaceholder />
        ) : filtered.length === 0 ? (
          <EmptyState description="暂无记忆" />
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
                  {(mem as any).source_session_id &&
                    ((mem as any).source_round_id || (mem as any).source_round_ids?.length > 0) && (
                      <Popover
                        content={`来源会话: ${(mem as any).source_session_id.slice(0, 8)}...`}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            cursor: 'pointer',
                            color: 'var(--ant-color-primary)'
                          }}
                          onClick={() => {
                            const sessionId = (mem as any).source_session_id as string
                            const messageId =
                              (mem as any).source_round_id ?? (mem as any).source_round_ids?.[0]
                            if (sessionId && messageId) {
                              navigateToAgentMessage(sessionId, messageId)
                            }
                          }}
                        >
                          <ExternalLink size={9} />
                          来源
                        </span>
                      </Popover>
                    )}
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
