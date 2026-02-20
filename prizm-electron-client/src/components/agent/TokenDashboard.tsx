/**
 * Token 仪表盘 — 条形图 + 分类统计 + 动画计数器
 * 替代旧版 TokenUsagePanel，用于总览面板
 */
import { motion } from 'motion/react'
import { Loader2, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { AnimatedCounter } from './AnimatedCounter'
import { createStyles } from 'antd-style'
import { fadeUp, STAGGER_DELAY, EASE_SMOOTH } from '../../theme/motionPresets'
import type { TokenUsageCategory } from '@prizm/client-core'
import {
  TOKEN_CATEGORY_LABELS as CATEGORY_LABELS,
  TOKEN_CATEGORY_COLORS as CATEGORY_COLORS,
  TOKEN_CATEGORY_ORDER as CATEGORY_ORDER,
  formatTokenCount as formatToken
} from '@prizm/shared'
import { RefreshIconButton } from '../ui/RefreshIconButton'

interface SummaryData {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCachedInputTokens?: number
  count: number
  byCategory: Record<
    string,
    { input: number; output: number; total: number; cached?: number; count: number }
  >
}

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
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
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  `,
  statCard: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 8px 12px;
    border-radius: 10px;
    background: ${token.colorFillQuaternary};
    border: 1px solid transparent;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
      border-color: ${token.colorBorderSecondary};
      box-shadow: 0 1px 4px ${isDarkMode ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.04)'};
    }
  `,
  statCardValue: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  `,
  statCardCacheValue: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorTextTertiary};
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  `,
  statCardLabel: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 4px;
    letter-spacing: 0.02em;
  `,
  ioBar: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  ioSegmentTrack: css`
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    background: ${token.colorFillSecondary};
    box-shadow: inset 0 1px 2px ${isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)'};
  `,
  ioLegend: css`
    display: flex;
    gap: 14px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    flex-wrap: wrap;
  `,
  ioLegendItem: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
  `,
  ioLegendDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
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
    padding: 2px 0;
    border-radius: 6px;
    transition: background 0.15s;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
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
    position: relative;
  `,
  barFill: css`
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  barCacheHatch: css`
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 4px;
    background: repeating-linear-gradient(
      -45deg,
      transparent 0px,
      transparent 2px,
      ${token.colorBgContainer} 2px,
      ${token.colorBgContainer} 4px
    );
    transition: left 0.5s cubic-bezier(0.33, 1, 0.68, 1), width 0.5s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  barValue: css`
    width: 64px;
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
    padding: 10px 14px;
    border-radius: 10px;
    background: ${token.colorPrimaryBg};
    border: 1px solid ${token.colorPrimaryBorder};
    transition: box-shadow 0.2s;

    &:hover {
      box-shadow: 0 2px 8px ${isDarkMode ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'};
    }
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

  const cacheHitPct = useMemo(() => {
    if (!summary || summary.totalInputTokens === 0) return 0
    return Math.round(((summary.totalCachedInputTokens ?? 0) / summary.totalInputTokens) * 100)
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
        <RefreshIconButton onClick={() => void load()} title="重试" size={12} />
      </div>
    )
  }

  if (!summary || summary.count === 0) {
    return <div className={styles.empty}>暂无 Token 使用记录</div>
  }

  const totalCached = summary.totalCachedInputTokens ?? 0
  const hasCacheData = totalCached > 0
  const freshInput = Math.max(0, summary.totalInputTokens - totalCached)
  const ioTotal = summary.totalInputTokens + summary.totalOutputTokens
  const inputPctOfTotal = ioTotal > 0 ? (summary.totalInputTokens / ioTotal) * 100 : 50
  const cachedPctOfInput =
    summary.totalInputTokens > 0 ? (totalCached / summary.totalInputTokens) * 100 : 0

  return (
    <div className={styles.container}>
      {/* 顶部统计卡片 — 4 列 */}
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
        <div className={styles.statCard}>
          {hasCacheData ? (
            <AnimatedCounter
              value={cacheHitPct}
              format={(n) => `${Math.round(n)}%`}
              className={styles.statCardCacheValue}
            />
          ) : (
            <span className={styles.statCardValue}>N/A</span>
          )}
          <span className={styles.statCardLabel}>缓存命中</span>
        </div>
      </motion.div>

      {/* IO 分段条形图：输入(蓝) + 输出(绿)，缓存用斜线纹理叠加在输入段 */}
      <motion.div className={styles.ioBar} {...fadeUp(STAGGER_DELAY)}>
        <div className={styles.ioSegmentTrack}>
          <motion.div
            style={{
              background: 'var(--ant-color-primary)',
              height: '100%',
              position: 'relative',
              overflow: 'hidden'
            }}
            initial={{ width: 0 }}
            animate={{ width: `${inputPctOfTotal}%` }}
            transition={{ duration: 0.5, ease: EASE_SMOOTH }}
          >
            {hasCacheData && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: `${cachedPctOfInput}%`,
                  background:
                    'repeating-linear-gradient(-45deg, transparent 0px, transparent 2px, var(--ant-color-bg-container) 2px, var(--ant-color-bg-container) 4px)',
                  transition: 'width 0.5s cubic-bezier(0.33, 1, 0.68, 1)'
                }}
              />
            )}
          </motion.div>
          <motion.div
            style={{ background: 'var(--ant-color-success)', height: '100%' }}
            initial={{ width: 0 }}
            animate={{ width: `${ioTotal > 0 ? (summary.totalOutputTokens / ioTotal) * 100 : 0}%` }}
            transition={{ duration: 0.5, ease: EASE_SMOOTH, delay: 0.05 }}
          />
        </div>
        <div className={styles.ioLegend}>
          <span className={styles.ioLegendItem}>
            <span
              className={styles.ioLegendDot}
              style={{ background: 'var(--ant-color-primary)' }}
            />
            输入 <strong>{formatToken(summary.totalInputTokens)}</strong>
          </span>
          <span className={styles.ioLegendItem}>
            <span
              className={styles.ioLegendDot}
              style={{ background: 'var(--ant-color-success)' }}
            />
            输出 <strong>{formatToken(summary.totalOutputTokens)}</strong>
          </span>
          {hasCacheData && (
            <span className={styles.ioLegendItem}>
              <span
                className={styles.ioLegendDot}
                style={{
                  background:
                    'repeating-linear-gradient(-45deg, var(--ant-color-primary) 0px, var(--ant-color-primary) 2px, var(--ant-color-bg-container) 2px, var(--ant-color-bg-container) 4px)',
                  borderRadius: 2
                }}
              />
              缓存 <strong>{formatToken(totalCached)}</strong>
              <span style={{ fontSize: 10, color: 'var(--ant-color-text-quaternary)' }}>
                ({cacheHitPct}%)
              </span>
            </span>
          )}
        </div>
      </motion.div>

      {/* 按类别条形图 */}
      <motion.div className={styles.barSection} {...fadeUp(STAGGER_DELAY * 2)}>
        <div className={styles.headerRow}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ant-color-text-secondary)' }}>
            按类别分布
          </span>
          <RefreshIconButton
            onClick={() => void load()}
            disabled={loading}
            title="刷新"
            size={11}
          />
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const data = summary.byCategory[cat]
          if (!data) return null
          const pct = (data.total / maxCategoryTotal) * 100
          const cachePct =
            maxCategoryTotal > 0 && (data.cached ?? 0) > 0
              ? ((data.cached ?? 0) / maxCategoryTotal) * 100
              : 0
          const color = CATEGORY_COLORS[cat] || '#94a3b8'
          const catCacheHit =
            data.input > 0 && (data.cached ?? 0) > 0
              ? Math.round(((data.cached ?? 0) / data.input) * 100)
              : 0

          return (
            <motion.div
              key={cat}
              className={styles.barRow}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE_SMOOTH }}
              title={
                catCacheHit > 0
                  ? `${CATEGORY_LABELS[cat] ?? cat} — 缓存命中 ${catCacheHit}%`
                  : undefined
              }
            >
              <span className={styles.barLabel} title={CATEGORY_LABELS[cat] ?? cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
              <div className={styles.barTrack}>
                <motion.div
                  className={styles.barFill}
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: EASE_SMOOTH, delay: 0.1 }}
                />
                {cachePct > 0 && (
                  <motion.div
                    className={styles.barCacheHatch}
                    style={{ left: `${pct - cachePct}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${cachePct}%` }}
                    transition={{ duration: 0.6, ease: EASE_SMOOTH, delay: 0.15 }}
                  />
                )}
              </div>
              <span className={styles.barValue}>
                {formatToken(data.total)}
                {catCacheHit > 0 && (
                  <span
                    style={{
                      color: 'var(--ant-color-text-quaternary)',
                      fontSize: 10,
                      marginLeft: 2
                    }}
                  >
                    {catCacheHit}%
                  </span>
                )}
              </span>
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
