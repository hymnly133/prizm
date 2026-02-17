/**
 * Token 使用可视化 - 按功能类别展示 token 消耗
 */
import { Coins, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import type { TokenUsageCategory } from '@prizm/client-core'
import { createStyles } from 'antd-style'
import { Button } from 'antd'

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  scopeRow: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    font-size: 13px;
  `,
  scopeLabel: css`
    color: ${token.colorTextSecondary};
  `,
  scopeValue: css`
    font-variant-numeric: tabular-nums;
    color: ${token.colorText};
  `,
  total: css`
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
    font-weight: 500;
  `,
  empty: css`
    font-size: 13px;
    color: ${token.colorTextQuaternary};
  `,
  loading: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: ${token.colorTextTertiary};
  `,
  error: css`
    font-size: 13px;
    color: ${token.colorError};
    margin-bottom: 8px;
  `,
  toolbar: css`
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 4px;
  `
}))

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

export function TokenUsagePanel() {
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

  if (!http) {
    return <div className={styles.empty}>请先连接服务器</div>
  }

  if (loading && !summary) {
    return (
      <div className={styles.loading}>
        <Loader2 size={14} className="spinning" />
        <span>加载中</span>
      </div>
    )
  }

  if (!summary && !error) {
    return <div className={styles.empty}>暂无 token 使用记录</div>
  }

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.error}>
          {error}
          <Button type="link" size="small" onClick={() => void load()} style={{ paddingLeft: 8 }}>
            重试
          </Button>
        </div>
      )}
      {!summary || summary.count === 0 ? (
        <div className={styles.empty}>暂无 token 使用记录</div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={12} />}
              onClick={() => void load()}
              disabled={loading}
            >
              刷新
            </Button>
          </div>
          {CATEGORY_ORDER.map(
            (cat) =>
              summary.byCategory[cat] && (
                <div key={cat} className={styles.scopeRow}>
                  <span className={styles.scopeLabel}>{CATEGORY_LABELS[cat]}</span>
                  <span className={styles.scopeValue}>
                    {formatToken(summary.byCategory[cat].total)} tokens
                    {summary.byCategory[cat].count > 1
                      ? ` (${summary.byCategory[cat].count} 次)`
                      : ''}
                  </span>
                </div>
              )
          )}
          <div className={`${styles.scopeRow} ${styles.total}`}>
            <span className={styles.scopeLabel}>
              <Coins size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              合计
            </span>
            <span className={styles.scopeValue}>
              {formatToken(summary.totalTokens)} ({formatToken(summary.totalInputTokens)} in /{' '}
              {formatToken(summary.totalOutputTokens)} out)
            </span>
          </div>
        </>
      )}
    </div>
  )
}
