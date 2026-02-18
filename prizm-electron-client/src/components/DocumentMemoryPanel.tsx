/**
 * DocumentMemoryPanel - 文档记忆面板
 * 展示与当前文档关联的记忆：概述、原子事实、迁移历史
 * 支持版本筛选：当前版本 / 全部版本
 * 使用 LobeUI + antd-style createStyles 统一风格
 */
import { useEffect, useCallback, useMemo, useState } from 'react'
import { Flexbox, Markdown } from '@lobehub/ui'
import { Tag } from 'antd'
import { Segmented } from './ui/Segmented'
import { createStyles } from 'antd-style'
import { motion, AnimatePresence } from 'motion/react'
import { Brain, RefreshCw, FileText, Lightbulb, GitBranch, Wand2 } from 'lucide-react'
import { useDocumentMemories } from '../hooks/useDocumentMemories'
import { EASE_SMOOTH } from '../theme/motionPresets'
import type { MemoryItem } from '@prizm/client-core'

type VersionFilter = 'current' | 'all'

const SUB_TYPE_CONFIG = {
  overview: { label: '概述', icon: FileText, color: '#1677ff' },
  fact: { label: '原子事实', icon: Lightbulb, color: '#faad14' },
  migration: { label: '迁移历史', icon: GitBranch, color: '#722ed1' }
} as const

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  `,
  refreshBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorPrimary};
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  sectionTitle: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 0;
  `,
  typeDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  `,
  overviewCard: css`
    padding: 10px 12px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadiusLG}px;
    border: 1px solid ${token.colorBorderSecondary};
    font-size: 13px;
    line-height: 1.6;

    .markdown-body {
      font-size: 12px;
      line-height: 1.55;
    }
  `,
  factItem: css`
    padding: 8px 10px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorText};
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
    cursor: default;
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  factItemExpanded: css`
    padding: 8px 10px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-word;
    cursor: default;

    .markdown-body {
      font-size: 12px;
      line-height: 1.5;
    }
  `,
  migrationItem: css`
    padding: 8px 12px;
    border-left: 2px solid ${token.colorBorder};
    font-size: 12px;
    transition: border-color 0.15s;

    &:hover {
      border-left-color: ${token.colorPrimary};
    }
  `,
  migrationVersion: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-bottom: 4px;
  `,
  migrationText: css`
    color: ${token.colorText};
    line-height: 1.5;

    .markdown-body {
      font-size: 12px;
      line-height: 1.5;
    }
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 0;
    color: ${token.colorTextQuaternary};
    font-size: 12px;
    gap: 6px;
  `,
  extractBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border: 1px solid ${token.colorBorder};
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    margin-top: 4px;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `
}))

interface DocumentMemoryPanelProps {
  documentId: string
  scope?: string
  visible?: boolean
}

export default function DocumentMemoryPanel({
  documentId,
  scope,
  visible = true
}: DocumentMemoryPanelProps) {
  const { styles } = useStyles()
  const {
    memories,
    allMemories,
    loading,
    extracting,
    error,
    fetchMemories,
    refresh,
    triggerExtract
  } = useDocumentMemories()
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('current')
  const [expandedFacts, setExpandedFacts] = useState<Set<string>>(new Set())
  const [manualExtracting, setManualExtracting] = useState(false)

  useEffect(() => {
    if (visible && documentId) {
      void fetchMemories(documentId, scope)
    }
  }, [visible, documentId, scope, fetchMemories])

  const handleRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  const handleManualExtract = useCallback(async () => {
    setManualExtracting(true)
    try {
      await triggerExtract()
    } finally {
      setManualExtracting(false)
    }
  }, [triggerExtract])

  // 从 migration 记忆中提取最新版本号
  const latestMigrationVersion = useMemo(() => {
    let max = -1
    for (const m of memories.migration) {
      const v = (m.metadata as Record<string, unknown>)?.version
      if (typeof v === 'number' && v > max) max = v
    }
    return max >= 0 ? max : null
  }, [memories.migration])

  // 按版本过滤
  const filteredMemories = useMemo(() => {
    if (versionFilter === 'all') return memories
    if (latestMigrationVersion === null) return memories

    return {
      ...memories,
      migration: memories.migration.filter((m) => {
        const v = (m.metadata as Record<string, unknown>)?.version
        return v === latestMigrationVersion
      })
    }
  }, [memories, versionFilter, latestMigrationVersion])

  const toggleFact = (id: string) => {
    setExpandedFacts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!visible) return null

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Brain size={16} style={{ opacity: 0.4 }} />
          </motion.div>
          <span>加载记忆中...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <Brain size={20} style={{ opacity: 0.3 }} />
          <span>加载失败: {error}</span>
        </div>
      </div>
    )
  }

  const hasAny =
    memories.overview.length > 0 ||
    memories.fact.length > 0 ||
    memories.migration.length > 0 ||
    memories.other.length > 0

  const totalCount = allMemories.length
  const hasMigrationVersions = latestMigrationVersion !== null && memories.migration.length > 0

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>
          <Brain size={13} />
          文档记忆
          {totalCount > 0 && <span className={styles.countBadge}>{totalCount}</span>}
        </span>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={loading}
          title="刷新记忆"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* 版本筛选 */}
      {hasMigrationVersions && (
        <Segmented
          block
          size="small"
          value={versionFilter}
          onChange={(v) => setVersionFilter(v as VersionFilter)}
          options={[
            { label: '当前版本', value: 'current' },
            { label: `全部 (${memories.migration.length})`, value: 'all' }
          ]}
        />
      )}

      {!hasAny ? (
        <div className={styles.empty}>
          {extracting || manualExtracting ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Brain size={18} style={{ opacity: 0.5 }} />
              </motion.div>
              <span>正在提取记忆...</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>完成后将自动刷新</span>
            </>
          ) : (
            <>
              <Brain size={22} style={{ opacity: 0.25 }} />
              <span>暂无关联记忆</span>
              <button
                type="button"
                className={styles.extractBtn}
                onClick={handleManualExtract}
                title="手动提取文档记忆"
              >
                <Wand2 size={12} />
                手动提取
              </button>
              <span style={{ fontSize: 11, opacity: 0.6 }}>或保存文档后自动提取</span>
            </>
          )}
        </div>
      ) : (
        <Flexbox gap={14}>
          {/* 概述区 */}
          {filteredMemories.overview.length > 0 && (
            <MemorySection type="overview">
              <div className={styles.overviewCard}>
                <Markdown>{filteredMemories.overview[0].memory}</Markdown>
              </div>
            </MemorySection>
          )}

          {/* 原子事实 */}
          {filteredMemories.fact.length > 0 && (
            <MemorySection type="fact" count={filteredMemories.fact.length}>
              <AnimatePresence mode="popLayout">
                {filteredMemories.fact.map((f, i) => {
                  const id = f.id || String(i)
                  const expanded = expandedFacts.has(id)
                  return (
                    <motion.div
                      key={id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15, delay: i * 0.02, ease: EASE_SMOOTH }}
                      onClick={() => toggleFact(id)}
                      style={{ cursor: 'pointer' }}
                    >
                      {expanded ? (
                        <div className={styles.factItemExpanded}>
                          <Markdown>{f.memory}</Markdown>
                        </div>
                      ) : (
                        <div className={styles.factItem}>{f.memory}</div>
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </MemorySection>
          )}

          {/* 迁移历史 */}
          {filteredMemories.migration.length > 0 && (
            <MemorySection type="migration" count={filteredMemories.migration.length}>
              <AnimatePresence mode="popLayout">
                {filteredMemories.migration.map((m, i) => (
                  <MigrationItem key={m.id || i} item={m} index={i} styles={styles} />
                ))}
              </AnimatePresence>
            </MemorySection>
          )}

          {/* 其他 */}
          {filteredMemories.other.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <Brain size={11} /> 其他 ({filteredMemories.other.length})
              </div>
              {filteredMemories.other.map((m, i) => (
                <div key={m.id || i} className={styles.factItem}>
                  {m.memory}
                </div>
              ))}
            </div>
          )}
        </Flexbox>
      )}
    </div>
  )
}

function MemorySection({
  type,
  count,
  children
}: {
  type: keyof typeof SUB_TYPE_CONFIG
  count?: number
  children: React.ReactNode
}) {
  const { styles } = useStyles()
  const config = SUB_TYPE_CONFIG[type]
  const Icon = config.icon
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <span className={styles.typeDot} style={{ background: config.color }} />
        <Icon size={11} />
        {config.label}
        {count != null && count > 0 && (
          <Tag
            bordered={false}
            style={{
              fontSize: 10,
              lineHeight: '16px',
              padding: '0 5px',
              marginInlineStart: 2,
              borderRadius: 8
            }}
          >
            {count}
          </Tag>
        )}
      </div>
      {children}
    </div>
  )
}

function MigrationItem({
  item,
  index,
  styles
}: {
  item: MemoryItem
  index: number
  styles: ReturnType<typeof useStyles>['styles']
}) {
  const ver = (item.metadata as Record<string, unknown>)?.version
  const timeStr = item.created_at
    ? new Date(item.created_at).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : null
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -4 }}
      transition={{ duration: 0.15, delay: index * 0.03, ease: EASE_SMOOTH }}
    >
      <div className={styles.migrationItem}>
        <div className={styles.migrationVersion}>
          {ver != null && (
            <Tag
              color="purple"
              bordered={false}
              style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px', borderRadius: 8 }}
            >
              v{String(ver)}
            </Tag>
          )}
          {timeStr && <span style={{ color: 'var(--ant-color-text-quaternary)' }}>{timeStr}</span>}
        </div>
        <div className={styles.migrationText}>
          <Markdown>{item.memory}</Markdown>
        </div>
      </div>
    </motion.div>
  )
}
