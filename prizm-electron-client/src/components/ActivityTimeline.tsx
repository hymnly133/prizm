/**
 * Activity Timeline - shows recent operations from audit log with source tracing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import {
  FileText,
  MessageSquare,
  Wrench,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Bot,
  User,
  Settings,
  ExternalLink,
  Lock,
  Unlock
} from 'lucide-react'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useNavigation } from '../context/NavigationContext'
import { EmptyState } from './ui/EmptyState'
import { subscribeSyncEvents } from '../events/syncEventEmitter'
import { createStyles } from 'antd-style'

interface AuditEntry {
  id: string
  scope: string
  actorType?: 'agent' | 'user' | 'system'
  sessionId?: string
  clientId?: string
  action: string
  toolName?: string
  resourceType?: string
  resourceId?: string
  resourceTitle?: string
  result: string
  detail?: string
  timestamp: number
}

const ACTION_LABELS: Record<string, string> = {
  tool_call: '工具调用',
  file_read: '读取文件',
  file_write: '写入文件',
  file_create: '创建文件',
  file_delete: '删除文件',
  doc_read: '读取文档',
  doc_write: '写入文档',
  doc_create: '创建文档',
  doc_delete: '删除文档',
  lock_acquire: '获取锁',
  lock_release: '释放锁',
  checkout: '检出',
  checkin: '检入',
  read: '读取',
  write: '写入',
  create: '创建',
  delete: '删除',
  update: '更新'
}

const ACTOR_CONFIG = {
  agent: { icon: Bot, color: 'blue' as const, label: 'Agent' },
  user: { icon: User, color: 'green' as const, label: '用户' },
  system: { icon: Settings, color: 'default' as const, label: '系统' }
} as const

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  header: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  `,
  timeline: css`
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;

    &::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: ${token.colorBorderSecondary};
    }
  `,
  entry: css`
    display: flex;
    gap: 12px;
    padding: 10px 0;
    position: relative;
  `,
  dot: css`
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: ${token.colorBgContainer};
    border: 2px solid ${token.colorBorderSecondary};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    z-index: 1;
    color: ${token.colorTextSecondary};
  `,
  dotSuccess: css`
    border-color: ${token.colorSuccess};
    color: ${token.colorSuccess};
  `,
  dotError: css`
    border-color: ${token.colorError};
    color: ${token.colorError};
  `,
  entryContent: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 4px;
  `,
  entryTitle: css`
    font-size: 13px;
    font-weight: 500;
    color: ${token.colorText};
    word-break: break-word;
  `,
  entryMeta: css`
    display: flex;
    gap: 6px;
    font-size: 12px;
    color: ${token.colorTextDescription};
    align-items: center;
    flex-wrap: wrap;
  `,
  sessionLink: css`
    cursor: pointer;
    color: ${token.colorPrimary};
    &:hover {
      text-decoration: underline;
    }
  `,
  empty: css`
    padding: 24px 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `,
  loading: css`
    padding: 24px 0;
    text-align: center;
    color: ${token.colorTextQuaternary};
    font-size: 13px;
  `
}))

function getActionIcon(action: string) {
  if (action === 'checkout' || action === 'lock_acquire') return Lock
  if (action === 'checkin' || action === 'lock_release') return Unlock
  if (action.startsWith('doc_') || action.startsWith('file_')) return FileText
  if (action === 'tool_call') return Wrench
  return MessageSquare
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHr < 24) return `${diffHr} 小时前`
  return d.toLocaleDateString()
}

function formatResourceLabel(entry: AuditEntry): string | null {
  if (!entry.resourceType) return null
  if (entry.resourceTitle) return `${entry.resourceType}: ${entry.resourceTitle}`
  if (entry.resourceId) {
    const short =
      entry.resourceId.length > 16 ? entry.resourceId.slice(0, 16) + '\u2026' : entry.resourceId
    return `${entry.resourceType}: ${short}`
  }
  return entry.resourceType
}

export function ActivityTimeline() {
  const { styles, cx } = useStyles()
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { chatWith, navigateToDocs } = useNavigation()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadEntries = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    setLoading(true)
    try {
      const res = await http.getAuditLog({
        scope: currentScope,
        limit: 30
      })
      setEntries((res.entries as AuditEntry[]) ?? [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [manager, currentScope])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsub = subscribeSyncEvents((eventType) => {
      if (eventType !== 'agent:message.completed') return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void loadEntries()
      }, 1500)
    })
    return () => {
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [loadEntries])

  const handleNavigateToSession = useCallback(
    (sessionId: string) => {
      chatWith({ sessionId })
    },
    [chatWith]
  )

  const handleNavigateToDocument = useCallback(
    (docId: string) => {
      navigateToDocs(docId)
    },
    [navigateToDocs]
  )

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span style={{ fontSize: 12, color: 'var(--ant-color-text-description)' }}>
          最近 {entries.length} 条操作记录
        </span>
        <Button size="small" icon={<RefreshCw size={12} />} onClick={() => void loadEntries()}>
          {loading ? '加载中...' : '刷新'}
        </Button>
      </div>

      {loading ? (
        <div className={styles.loading}>加载中...</div>
      ) : entries.length === 0 ? (
        <EmptyState description="暂无操作记录" />
      ) : (
        <div className={styles.timeline}>
          {entries.map((entry) => {
            const IconComp = getActionIcon(entry.action)
            const isSuccess = entry.result === 'success'
            const isError = entry.result === 'error' || entry.result === 'denied'
            const actorCfg = entry.actorType ? ACTOR_CONFIG[entry.actorType] : null
            const resourceLabel = formatResourceLabel(entry)

            return (
              <div key={entry.id} className={styles.entry}>
                <div
                  className={cx(
                    styles.dot,
                    isSuccess && styles.dotSuccess,
                    isError && styles.dotError
                  )}
                >
                  <IconComp size={14} />
                </div>
                <div className={styles.entryContent}>
                  <span className={styles.entryTitle}>
                    {`${ACTION_LABELS[entry.action] ?? entry.action}${
                      entry.toolName ? ` · ${entry.toolName}` : ''
                    }`}
                  </span>
                  <div className={styles.entryMeta}>
                    <Tooltip title={new Date(entry.timestamp).toLocaleString()}>
                      <span style={{ cursor: 'help' }}>
                        <Clock size={11} style={{ marginRight: 2 }} />
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </Tooltip>
                    {actorCfg && (
                      <Tag size="small" color={actorCfg.color}>
                        {<actorCfg.icon size={10} style={{ marginRight: 2, verticalAlign: -1 }} />}
                        {actorCfg.label}
                      </Tag>
                    )}
                    {entry.sessionId && entry.actorType === 'agent' && (
                      <Tooltip title={`会话 ${entry.sessionId}`}>
                        <span
                          className={styles.sessionLink}
                          onClick={() => handleNavigateToSession(entry.sessionId!)}
                        >
                          {entry.sessionId.slice(0, 8)}
                          <ExternalLink size={10} style={{ marginLeft: 2, verticalAlign: -1 }} />
                        </span>
                      </Tooltip>
                    )}
                    {resourceLabel && entry.resourceType === 'document' && entry.resourceId ? (
                      <Tooltip title={`文档: ${entry.resourceTitle || entry.resourceId}`}>
                        <span
                          className={styles.sessionLink}
                          onClick={() => handleNavigateToDocument(entry.resourceId!)}
                        >
                          <FileText size={10} style={{ marginRight: 2, verticalAlign: -1 }} />
                          {entry.resourceTitle
                            ? entry.resourceTitle.length > 16
                              ? `${entry.resourceTitle.slice(0, 16)}…`
                              : entry.resourceTitle
                            : entry.resourceId.slice(0, 8)}
                          <ExternalLink size={10} style={{ marginLeft: 2, verticalAlign: -1 }} />
                        </span>
                      </Tooltip>
                    ) : resourceLabel ? (
                      <Tag size="small">{resourceLabel}</Tag>
                    ) : null}
                    {isSuccess && (
                      <CheckCircle size={12} style={{ color: 'var(--ant-color-success)' }} />
                    )}
                    {isError && <XCircle size={12} style={{ color: 'var(--ant-color-error)' }} />}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
