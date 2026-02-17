/**
 * Token 仪表盘 — 条形图 + 分类统计 + 动画计数器
 * 替代旧版 TokenUsagePanel，用于总览面板
 */
import { motion } from 'motion/react'
import { Coins, Loader2, RefreshCw, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { AnimatedCounter } from './AnimatedCounter'
import { createStyles } from 'antd-style'
import { fadeUp, STAGGER_DELAY, EASE_SMOOTH } from '../../theme/motionPresets'
import type { TokenUsageCategory } from '@prizm/client-core'

const CATEGORY_LABELS: Record<TokenUsageCategory, string> = {
  chat: '对话',
  conversation_summary: '对话摘要',
  'memory:conversation_extract': '记忆提取（对话）',
  'memory:document_extract': '记忆提取（文档）',
  'memory:document_migration': '文档迁移记忆',
  'memory:dedup': '记忆去重',
  'memory:profile_merge': '画像合并',
  'memory:query_expansion': '查询扩展',
  document_summary: '文档摘要'
}

const CATEGORY_COLORS: Record<string, string> = {
  chat: '#1677ff',
  conversation_summary: '#722ed1',
  'memory:conversation_extract': '#13c2c2',
  'memory:document_extract': '#52c41a',
  'memory:document_migration': '#fa8c16',
  'memory:dedup': '#eb2f96',
  'memory:profile_merge': '#faad14',
  'memory:query_expansion': '#2f54eb',
  document_summary: '#389e0d'
}

const CATEGORY_ORDER: TokenUsageCategory[] = [
  'chat',
  'conversation_summary',
  'memory:conversation_extract',
  'memory:document_extract',
  'memory:document_migration',
  'memory:dedup',
  'memory:profile_merge',
  'memory:query_expansion',
  'document_summary'
]

function formatToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface SummaryData {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  count: number
  byCategory: Record<string, { input: number; output: number; total: number; count: number }>
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  statCards: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  `,
  statCard: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    border-radius: 10px;
    background: ${token.colorFillQuaternary};
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  statCardValue: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  `,
  statCardLabel: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 4px;
  `,
  barSection: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  barRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  barLabel: css`
    width: 110px;
    font-size: 12px;
    color: ${token.colorTextSecondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  `,
  barTrack: css`
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: ${token.colorFillSecondary};
    overflow: hidden;
    min-width: 40px;
  `,
  barFill: css`
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  barValue: css`
    width: 56px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${token.colorTextSecondary};
    text-align: right;
    flex-shrink: 0;
  `,
  totalRow: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-radius: 8px;
    background: ${token.colorPrimaryBg};
    border: 1px solid ${token.colorPrimaryBorder};
  `,
  totalLabel: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorPrimary};
  `,
  totalValue: css`
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${token.colorPrimary};
  `,
  ioBreakdown: css`
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 4px;
  `,
  empty: css`
    font-size: 13px;
    color: ${token.colorTextQuaternary};
    text-align: center;
    padding: 20px 0;
  `,
  loading: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: ${token.colorTextTertiary};
    justify-content: center;
    padding: 20px 0;
  `,
  refreshBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid ${token.colorBorder};
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextSecondary};
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: ${token.colorPrimary};
      color: ${token.colorPrimary};
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
  error: css`
    font-size: 12px;
    color: ${token.colorError};
    text-align: center;
    padding: 8px;
  `
}))

export function TokenDashboard() {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    setError(null)
    try {
      const result = await http.getTokenUsage()
      setSummary(result.summary ?? null)
    } catch (e) {
      setSummary(null)
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [http])

  useEffect(() => {
    void load()
  }, [load])

  const maxCategoryTotal = useMemo(() => {
    if (!summary?.byCategory) return 1
    return Math.max(1, ...Object.values(summary.byCategory).map((c) => c.total))
  }, [summary])

  const avgPerCall = useMemo(() => {
    if (!summary || summary.count === 0) return 0
    return Math.round(summary.totalTokens / summary.count)
  }, [summary])

  if (!http) return <div className={styles.empty}>请先连接服务器</div>

  if (loading && !summary) {
    return (
      <div className={styles.loading}>
        <Loader2 size={14} className="spinning" />
        <span>加载中</span>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className={styles.error}>
        {error}
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => void load()}
          style={{ marginLeft: 8 }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
    )
  }

  if (!summary || summary.count === 0) {
    return <div className={styles.empty}>暂无 Token 使用记录</div>
  }

  return (
    <div className={styles.container}>
      {/* 顶部统计卡片 */}
      <motion.div className={styles.statCards} {...fadeUp(0)}>
        <div className={styles.statCard}>
          <AnimatedCounter value={summary.totalTokens} className={styles.statCardValue} />
          <span className={styles.statCardLabel}>总消耗</span>
        </div>
        <div className={styles.statCard}>
          <AnimatedCounter
            value={summary.count}
            format={(n) => String(Math.round(n))}
            className={styles.statCardValue}
          />
          <span className={styles.statCardLabel}>调用次数</span>
        </div>
        <div className={styles.statCard}>
          <AnimatedCounter value={avgPerCall} className={styles.statCardValue} />
          <span className={styles.statCardLabel}>平均/次</span>
        </div>
      </motion.div>

      {/* IO 分解 */}
      <motion.div className={styles.ioBreakdown} {...fadeUp(STAGGER_DELAY)}>
        <span>
          Input: <strong>{formatToken(summary.totalInputTokens)}</strong>
        </span>
        <span>
          Output: <strong>{formatToken(summary.totalOutputTokens)}</strong>
        </span>
      </motion.div>

      {/* 按类别条形图 */}
      <motion.div className={styles.barSection} {...fadeUp(STAGGER_DELAY * 2)}>
        <div className={styles.headerRow}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ant-color-text-secondary)' }}>
            按类别分布
          </span>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => void load()}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const data = summary.byCategory[cat]
          if (!data) return null
          const pct = (data.total / maxCategoryTotal) * 100
          const color = CATEGORY_COLORS[cat] || '#94a3b8'

          return (
            <motion.div
              key={cat}
              className={styles.barRow}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE_SMOOTH }}
            >
              <span className={styles.barLabel} title={CATEGORY_LABELS[cat]}>
                {CATEGORY_LABELS[cat]}
              </span>
              <div className={styles.barTrack}>
                <motion.div
                  className={styles.barFill}
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: EASE_SMOOTH, delay: 0.1 }}
                />
              </div>
              <span className={styles.barValue}>{formatToken(data.total)}</span>
            </motion.div>
          )
        })}
      </motion.div>

      {/* 合计 */}
      <motion.div className={styles.totalRow} {...fadeUp(STAGGER_DELAY * 3)}>
        <span className={styles.totalLabel}>
          <TrendingUp size={14} />
          合计
        </span>
        <span className={styles.totalValue}>{formatToken(summary.totalTokens)} tokens</span>
      </motion.div>
    </div>
  )
}
