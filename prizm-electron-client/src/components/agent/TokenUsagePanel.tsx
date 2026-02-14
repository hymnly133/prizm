/**
 * Token 使用可视化 - 按功能 scope 展示当前用户的 token 消耗
 */
import { Coins, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import type { TokenUsageRecord, TokenUsageScope } from '@prizm/client-core'
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

const SCOPE_LABELS: Record<TokenUsageScope, string> = {
  chat: '对话',
  document_summary: '文档摘要',
  conversation_summary: '对话摘要',
  memory: '记忆'
}

function formatToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function TokenUsagePanel() {
  const { styles } = useStyles()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const [records, setRecords] = useState<TokenUsageRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!http) return
    setLoading(true)
    setError(null)
    try {
      const { records: list } = await http.getTokenUsage()
      setRecords(list ?? [])
    } catch (e) {
      setRecords([])
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [http])

  useEffect(() => {
    void load()
  }, [load])

  const byScope = records.reduce((acc, r) => {
    const scope = r.usageScope
    if (!acc[scope]) acc[scope] = { input: 0, output: 0, total: 0, count: 0 }
    acc[scope].input += r.inputTokens
    acc[scope].output += r.outputTokens
    acc[scope].total += r.totalTokens
    acc[scope].count += 1
    return acc
  }, {} as Record<TokenUsageScope, { input: number; output: number; total: number; count: number }>)

  const totalInput = records.reduce((s, r) => s + r.inputTokens, 0)
  const totalOutput = records.reduce((s, r) => s + r.outputTokens, 0)
  const totalAll = records.reduce((s, r) => s + r.totalTokens, 0)

  if (!http) {
    return <div className={styles.empty}>请先连接服务器</div>
  }

  if (loading && records.length === 0) {
    return (
      <div className={styles.loading}>
        <Loader2 size={14} className="spinning" />
        <span>加载中</span>
      </div>
    )
  }

  const scopes: TokenUsageScope[] = ['chat', 'document_summary', 'conversation_summary', 'memory']

  if (records.length === 0 && !error) {
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
      {records.length === 0 ? (
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
          {scopes.map(
            (scope) =>
              byScope[scope] && (
                <div key={scope} className={styles.scopeRow}>
                  <span className={styles.scopeLabel}>{SCOPE_LABELS[scope]}</span>
                  <span className={styles.scopeValue}>
                    {formatToken(byScope[scope].total)} tokens
                    {byScope[scope].count > 1 ? ` (${byScope[scope].count} 次)` : ''}
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
              {formatToken(totalAll)} ({formatToken(totalInput)} in / {formatToken(totalOutput)}{' '}
              out)
            </span>
          </div>
        </>
      )}
    </div>
  )
}
