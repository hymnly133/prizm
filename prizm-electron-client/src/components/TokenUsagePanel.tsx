/**
 * Token 使用量详情面板
 * 展示 token 消耗的汇总统计、按类别/模型/Scope 分布、以及最近请求记录
 */
import { Button, toast } from '@lobehub/ui'
import { Segmented } from './ui/Segmented'
import { EmptyState } from './ui/EmptyState'
import { createStaticStyles } from 'antd-style'
import { Activity, BarChart3, Clock, Cpu, Database, Layers, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { PrizmClient, TokenUsageRecord } from '@prizm/client-core'

// ==================== 类型 ====================

interface BucketStat {
  input: number
  output: number
  total: number
  cached: number
  count: number
}

interface TokenUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCachedInputTokens: number
  count: number
  byCategory: Record<string, BucketStat>
  byDataScope: Record<string, BucketStat>
  byModel: Record<string, BucketStat>
}

// ==================== 样式 ====================

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionTitle: css`
    position: relative;
    display: flex;
    gap: ${cssVar.marginXS};
    align-items: center;
    height: 28px;
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextHeading};
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      margin-inline-start: ${cssVar.marginMD};
      background: linear-gradient(to right, ${cssVar.colorBorder}, transparent);
    }
  `,
  statGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
    margin: 10px 0;
  `,
  statItem: css`
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    transition: border-color 0.2s, box-shadow 0.2s;

    &:hover {
      border-color: ${cssVar.colorBorder};
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
  `,
  statLabel: css`
    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  `,
  statValue: css`
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
    font-variant-numeric: tabular-nums;
  `,
  statUnit: css`
    font-size: 11px;
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};
    margin-left: 2px;
  `,
  cardHeader: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,
  buttonGroup: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  tableWrap: css`
    margin-top: 10px;
    overflow-x: auto;
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  `,
  th: css`
    text-align: left;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextDescription};
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 2px solid ${cssVar.colorBorder};
    white-space: nowrap;
  `,
  thRight: css`
    text-align: right;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextDescription};
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 2px solid ${cssVar.colorBorder};
    white-space: nowrap;
  `,
  td: css`
    padding: 6px 10px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    color: ${cssVar.colorText};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  `,
  tdRight: css`
    padding: 6px 10px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    color: ${cssVar.colorText};
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  `,
  tdMono: css`
    padding: 6px 10px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    color: ${cssVar.colorText};
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 11px;
  `,
  percentBar: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  percentBarInner: css`
    height: 6px;
    border-radius: 3px;
    background: ${cssVar.colorPrimary};
    transition: width 0.3s ease;
  `,
  percentBarTrack: css`
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: ${cssVar.colorFillQuaternary};
    overflow: hidden;
    min-width: 40px;
  `,
  percentText: css`
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  `,
  categoryBadge: css`
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    background: ${cssVar.colorFillQuaternary};
    color: ${cssVar.colorText};
  `,
  paginationBar: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  emptyHint: css`
    padding: 24px 0;
    text-align: center;
    color: ${cssVar.colorTextDescription};
    font-size: 13px;
  `,
  statValueSmall: css`
    font-size: 14px;
  `,
  statValueCache: css`
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    font-variant-numeric: tabular-nums;
  `,
  cacheBarMini: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  `,
  cacheBarMiniTrack: css`
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: ${cssVar.colorFillQuaternary};
    overflow: hidden;
  `,
  cacheBarMiniFill: css`
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorPrimary};
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0px,
      transparent 1.5px,
      ${cssVar.colorBgContainer} 1.5px,
      ${cssVar.colorBgContainer} 3px
    );
    transition: width 0.4s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  cacheBarMiniPct: css`
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
  `,
  tdCache: css`
    padding: 6px 10px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    color: ${cssVar.colorTextQuaternary};
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 11px;
  `
}))

// ==================== 常量 ====================

type TimeRange = 'all' | 'today' | '7d' | '30d'

const TIME_RANGE_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '全部', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '近 7 天', value: '7d' },
  { label: '近 30 天', value: '30d' }
]

const CATEGORY_LABELS: Record<string, string> = {
  chat: '对话',
  conversation_summary: '对话摘要',
  'memory:conversation_extract': '对话记忆提取',
  'memory:document_extract': '文档记忆提取',
  'memory:document_migration': '文档迁移记忆',
  'memory:dedup': '记忆去重',
  'memory:profile_merge': '画像合并',
  'memory:query_expansion': '查询扩展',
  'memory:eventlog_extract': '事件日志提取',
  'memory:foresight_extract': '前瞻提取'
}

const PAGE_SIZE = 20

// ==================== 工具函数 ====================

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function getTimeRangeFilter(range: TimeRange): { from?: number; to?: number } {
  if (range === 'all') return {}
  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  switch (range) {
    case 'today':
      return { from: todayStart.getTime() }
    case '7d':
      return { from: now - 7 * 24 * 60 * 60 * 1000 }
    case '30d':
      return { from: now - 30 * 24 * 60 * 60 * 1000 }
    default:
      return {}
  }
}

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

// ==================== 子组件：分布表 ====================

function DistributionTable({
  data,
  labelHeader,
  labelFormatter,
  maxTotal
}: {
  data: Record<string, BucketStat>
  labelHeader: string
  labelFormatter?: (key: string) => string
  maxTotal: number
}) {
  const entries = Object.entries(data).sort((a, b) => b[1].total - a[1].total)
  const showCache = entries.some(([, stat]) => (stat.cached ?? 0) > 0)

  if (entries.length === 0) {
    return <EmptyState description="暂无数据" />
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>{labelHeader}</th>
            <th className={styles.thRight}>输入</th>
            {showCache && <th className={styles.thRight}>缓存</th>}
            {showCache && <th className={styles.thRight}>缓存率</th>}
            <th className={styles.thRight}>输出</th>
            <th className={styles.thRight}>合计</th>
            <th className={styles.thRight}>请求数</th>
            <th className={styles.th} style={{ minWidth: 100 }}>
              占比
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, stat]) => {
            const pct = maxTotal > 0 ? (stat.total / maxTotal) * 100 : 0
            const cacheRate =
              stat.input > 0 && (stat.cached ?? 0) > 0
                ? (((stat.cached ?? 0) / stat.input) * 100).toFixed(0)
                : null
            return (
              <tr key={key}>
                <td className={styles.td}>
                  <span className={styles.categoryBadge}>
                    {labelFormatter ? labelFormatter(key) : key}
                  </span>
                </td>
                <td className={styles.tdRight}>{formatTokens(stat.input)}</td>
                {showCache && (
                  <td className={styles.tdCache}>
                    {(stat.cached ?? 0) > 0 ? formatTokens(stat.cached) : '-'}
                  </td>
                )}
                {showCache && (
                  <td className={styles.tdCache}>{cacheRate != null ? `${cacheRate}%` : '-'}</td>
                )}
                <td className={styles.tdRight}>{formatTokens(stat.output)}</td>
                <td className={styles.tdRight}>{formatTokens(stat.total)}</td>
                <td className={styles.tdRight}>{formatNumber(stat.count)}</td>
                <td className={styles.td}>
                  <div className={styles.percentBar}>
                    <div className={styles.percentBarTrack}>
                      <div
                        className={styles.percentBarInner}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className={styles.percentText}>{pct.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ==================== 子组件：最近记录表 ====================

function RecentRecordsTable({
  records,
  page,
  totalCount,
  onPageChange,
  loading
}: {
  records: TokenUsageRecord[]
  page: number
  totalCount: number
  onPageChange: (page: number) => void
  loading: boolean
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const showCacheCol = records.some((r) => (r.cachedInputTokens ?? 0) > 0)

  if (records.length === 0 && !loading) {
    return <EmptyState description="暂无记录" />
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>时间</th>
              <th className={styles.th}>类别</th>
              <th className={styles.th}>模型</th>
              <th className={styles.thRight}>输入</th>
              {showCacheCol && <th className={styles.thRight}>缓存</th>}
              <th className={styles.thRight}>输出</th>
              <th className={styles.thRight}>合计</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const rCached = r.cachedInputTokens ?? 0
              const rCachePct =
                rCached > 0 && r.inputTokens > 0 ? Math.round((rCached / r.inputTokens) * 100) : 0
              return (
                <tr key={r.id}>
                  <td className={styles.tdMono}>
                    {new Date(r.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </td>
                  <td className={styles.td}>
                    <span className={styles.categoryBadge}>{getCategoryLabel(r.category)}</span>
                  </td>
                  <td className={styles.tdMono}>{r.model || '-'}</td>
                  <td className={styles.tdRight}>{formatNumber(r.inputTokens)}</td>
                  {showCacheCol && (
                    <td className={styles.tdCache}>
                      {rCached > 0 ? (
                        <span>
                          {formatNumber(rCached)}
                          <span style={{ fontSize: 10, marginLeft: 2, opacity: 0.8 }}>
                            ({rCachePct}%)
                          </span>
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                  <td className={styles.tdRight}>{formatNumber(r.outputTokens)}</td>
                  <td className={styles.tdRight}>{formatNumber(r.totalTokens)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalCount > PAGE_SIZE && (
        <div className={styles.paginationBar}>
          <span>
            共 {formatNumber(totalCount)} 条，第 {page}/{totalPages} 页
          </span>
          <div className={styles.buttonGroup}>
            <Button
              size="small"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
            >
              上一页
            </Button>
            <Button
              size="small"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

// ==================== 主组件 ====================

interface Props {
  http: PrizmClient | null
  onLog?: (msg: string, type: 'info' | 'success' | 'error' | 'warning') => void
}

export function TokenUsagePanel({ http, onLog }: Props) {
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null)
  const [records, setRecords] = useState<TokenUsageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const loadData = useCallback(
    async (range: TimeRange, currentPage: number) => {
      if (!http) return
      setLoading(true)
      try {
        const { from, to } = getTimeRangeFilter(range)
        const result = await http.getTokenUsage({
          from,
          to,
          limit: PAGE_SIZE,
          offset: (currentPage - 1) * PAGE_SIZE
        })
        setSummary(result.summary)
        setRecords(result.records)
        setTotalCount(result.summary.count)
      } catch (e) {
        onLog?.(`加载 Token 使用量失败: ${e}`, 'error')
        toast.error(`加载失败: ${e}`)
      } finally {
        setLoading(false)
      }
    },
    [http, onLog]
  )

  useEffect(() => {
    void loadData(timeRange, page)
  }, [loadData, timeRange, page])

  function handleTimeRangeChange(range: TimeRange) {
    setTimeRange(range)
    setPage(1)
  }

  function handleRefresh() {
    void loadData(timeRange, page)
  }

  const s = summary

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Token 用量</h2>
        <p className="form-hint">查看 LLM API 调用的 Token 消耗统计与明细记录</p>
      </div>

      {/* 时间范围筛选 + 刷新 */}
      <div className="settings-card">
        <div className={styles.cardHeader}>
          <div className={styles.sectionTitle} style={{ flex: 1 }}>
            <Clock size={16} />
            时间范围
          </div>
          <Button size="small" onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={13} />
          </Button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Segmented
            value={timeRange}
            onChange={(v) => handleTimeRangeChange(v as TimeRange)}
            options={TIME_RANGE_OPTIONS}
          />
        </div>
      </div>

      {/* 汇总统计卡片 */}
      {s &&
        (() => {
          const totalCached = s.totalCachedInputTokens ?? 0
          const hasCacheData = totalCached > 0
          const cacheRate =
            s.totalInputTokens > 0 ? ((totalCached / s.totalInputTokens) * 100).toFixed(1) : null
          const freshInput = Math.max(0, s.totalInputTokens - totalCached)

          return (
            <div className="settings-card">
              <div className={styles.sectionTitle}>
                <Activity size={16} />
                汇总
              </div>
              <div className={styles.statGrid}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>总 Token</span>
                  <span className={styles.statValue}>{formatTokens(s.totalTokens)}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>输入 Token</span>
                  <span className={styles.statValue}>{formatTokens(s.totalInputTokens)}</span>
                </div>
                {hasCacheData && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>实际输入</span>
                    <span className={styles.statValue}>{formatTokens(freshInput)}</span>
                  </div>
                )}
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>输出 Token</span>
                  <span className={styles.statValue}>{formatTokens(s.totalOutputTokens)}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>请求数</span>
                  <span className={styles.statValue}>{formatNumber(s.count)}</span>
                </div>
                {hasCacheData && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>缓存命中</span>
                    <span className={styles.statValueCache}>{formatTokens(totalCached)}</span>
                    <div className={styles.cacheBarMini}>
                      <div className={styles.cacheBarMiniTrack}>
                        <div
                          className={styles.cacheBarMiniFill}
                          style={{ width: `${cacheRate ?? 0}%` }}
                        />
                      </div>
                      <span className={styles.cacheBarMiniPct}>
                        {cacheRate != null ? `${cacheRate}%` : '-'}
                      </span>
                    </div>
                  </div>
                )}
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>平均 Token/请求</span>
                  <span className={`${styles.statValue} ${styles.statValueSmall}`}>
                    {s.count > 0 ? Math.round(s.totalTokens / s.count).toLocaleString() : '-'}
                  </span>
                </div>
              </div>
            </div>
          )
        })()}

      {/* 按类别分布 */}
      {s && Object.keys(s.byCategory).length > 0 && (
        <div className="settings-card">
          <div className={styles.sectionTitle}>
            <Layers size={16} />
            按类别
          </div>
          <DistributionTable
            data={s.byCategory}
            labelHeader="类别"
            labelFormatter={getCategoryLabel}
            maxTotal={s.totalTokens}
          />
        </div>
      )}

      {/* 按模型分布 */}
      {s && Object.keys(s.byModel).length > 0 && (
        <div className="settings-card">
          <div className={styles.sectionTitle}>
            <Cpu size={16} />
            按模型
          </div>
          <DistributionTable data={s.byModel} labelHeader="模型" maxTotal={s.totalTokens} />
        </div>
      )}

      {/* 按 Scope 分布 */}
      {s && Object.keys(s.byDataScope).length > 1 && (
        <div className="settings-card">
          <div className={styles.sectionTitle}>
            <Database size={16} />
            按工作区
          </div>
          <DistributionTable data={s.byDataScope} labelHeader="Scope" maxTotal={s.totalTokens} />
        </div>
      )}

      {/* 最近请求记录 */}
      <div className="settings-card">
        <div className={styles.sectionTitle}>
          <BarChart3 size={16} />
          请求明细
        </div>
        <RecentRecordsTable
          records={records}
          page={page}
          totalCount={totalCount}
          onPageChange={setPage}
          loading={loading}
        />
      </div>
    </div>
  )
}
