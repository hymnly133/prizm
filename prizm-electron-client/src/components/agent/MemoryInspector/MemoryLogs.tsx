import { Button, Input, Select, Tag, Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../ui/EmptyState'
import { LoadingPlaceholder } from '../../ui/LoadingPlaceholder'
import { usePrizmContext } from '../../../context/PrizmContext'
import type { MemoryLogEntry } from '@prizm/client-core'
import { useMemoryStyles } from './styles'

/** 事件类型 → 颜色映射 */
const EVENT_COLORS: Record<string, string> = {
  conv_memory: 'cyan',
  doc_memory: 'blue',
  memory: 'green',
  manager: 'purple',
  handler: 'orange',
  cache: 'gold'
}

function getEventColor(event: string): string {
  const prefix = event.split(':')[0]
  return EVENT_COLORS[prefix] ?? 'default'
}

/** 事件类型 → 中文标签映射 */
const EVENT_LABELS: Record<string, string> = {
  'conv_memory:buffer_append': '缓冲追加',
  'conv_memory:buffer_skip_flush': '未到边界',
  'conv_memory:buffer_time_gap_flush': '时间间隔flush',
  'conv_memory:flush_start': '开始flush',
  'conv_memory:flush_result': 'flush结果',
  'conv_memory:flush_error': 'flush错误',
  'conv_memory:session_flush': '会话flush',
  'conv_memory:chat_trigger': '对话触发',
  'conv_memory:compression_trigger': '压缩触发',
  'doc_memory:schedule': '文档调度',
  'doc_memory:start': '文档开始',
  'doc_memory:skip': '文档跳过',
  'doc_memory:delete_old': '删旧记忆',
  'doc_memory:extract_start': '开始抽取',
  'doc_memory:extract_done': '抽取完成',
  'doc_memory:migration_start': '迁移开始',
  'doc_memory:migration_done': '迁移完成',
  'doc_memory:migration_skip': '迁移跳过',
  'doc_memory:complete': '文档完成',
  'doc_memory:error': '文档错误',
  'memory:store': '存储',
  'memory:delete': '删除',
  'memory:clear': '清空',
  'memory:query': '查询',
  'manager:unified_result': '统一结果',
  'manager:insert': '写入',
  'manager:dedup': '去重',
  'manager:error': '错误',
  'handler:document_saved': '文档保存事件',
  'handler:session_deleted': '会话删除事件',
  'cache:init': '缓存初始化',
  'cache:invalidate': '缓存失效'
}

/** 事件分类用于过滤 */
const EVENT_CATEGORY_OPTIONS = [
  { value: 'conv_memory', label: '对话记忆' },
  { value: 'doc_memory', label: '文档记忆' },
  { value: 'memory', label: '记忆操作' },
  { value: 'manager', label: 'MemoryManager' },
  { value: 'handler', label: '事件处理' },
  { value: 'cache', label: '缓存' }
]

interface MemoryLogsProps {
  open: boolean
}

export function MemoryLogs({ open }: MemoryLogsProps) {
  const { styles } = useMemoryStyles()
  const [logs, setLogs] = useState<MemoryLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined)
  const [filterText, setFilterText] = useState('')
  const [limit, setLimit] = useState(200)
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()

  const loadLogs = useCallback(async () => {
    if (!http) return
    setLoading(true)
    try {
      const res = await (
        http as typeof http & { getMemoryLogs(limit?: number): Promise<{ logs: MemoryLogEntry[] }> }
      ).getMemoryLogs(limit)
      setLogs(res.logs ?? [])
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [http, limit])

  useEffect(() => {
    if (open) void loadLogs()
  }, [open, loadLogs])

  const filtered = logs.filter((entry) => {
    if (filterCategory && !entry.event.startsWith(filterCategory + ':')) return false
    if (filterText) {
      const searchStr = filterText.toLowerCase()
      const haystack = [
        entry.event,
        entry.scope ?? '',
        entry.sessionId ?? '',
        entry.documentId ?? '',
        entry.error ?? '',
        JSON.stringify(entry.detail ?? {})
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(searchStr)) return false
    }
    return true
  })

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <Select
          allowClear
          placeholder="事件分类"
          options={EVENT_CATEGORY_OPTIONS}
          value={filterCategory}
          onChange={setFilterCategory}
          style={{ width: 140 }}
          size="small"
        />
        <Input
          placeholder="搜索 (scope/session/关键词)"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          size="small"
          style={{ flex: 1, minWidth: 0 }}
          allowClear
        />
        <Select
          value={limit}
          onChange={setLimit}
          options={[
            { value: 50, label: '50条' },
            { value: 100, label: '100条' },
            { value: 200, label: '200条' },
            { value: 500, label: '500条' }
          ]}
          size="small"
          style={{ width: 80 }}
        />
        <Button size="small" onClick={() => void loadLogs()} loading={loading}>
          刷新
        </Button>
      </div>

      <div className={styles.partition}>
        {loading ? (
          <LoadingPlaceholder className={styles.empty} />
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              description={logs.length === 0 ? '暂无记忆日志' : '没有匹配的日志'}
            />
          </div>
        ) : (
          [...filtered]
            .reverse()
            .map((entry, idx) => <LogEntry key={`${entry.ts}-${idx}`} entry={entry} />)
        )}
      </div>
    </div>
  )
}

function LogEntry({ entry }: { entry: MemoryLogEntry }) {
  const { styles } = useMemoryStyles()
  const [expanded, setExpanded] = useState(false)

  const label = EVENT_LABELS[entry.event] ?? entry.event
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0
  const hasError = !!entry.error
  const ts = entry.ts ? new Date(entry.ts).toLocaleString() : ''

  return (
    <div
      className={styles.logItem}
      onClick={() => (hasDetail || hasError) && setExpanded((v) => !v)}
      style={{ cursor: hasDetail || hasError ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag color={getEventColor(entry.event)} style={{ margin: 0, fontSize: 11 }}>
          {label}
        </Tag>
        {entry.scope && (
          <Tooltip title="Scope">
            <Tag variant="outlined" style={{ margin: 0, fontSize: 11 }}>
              {entry.scope}
            </Tag>
          </Tooltip>
        )}
        {entry.sessionId && (
          <Tooltip title="Session ID">
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-description)' }}>
              S:{entry.sessionId.slice(0, 8)}
            </span>
          </Tooltip>
        )}
        {entry.documentId && (
          <Tooltip title="Document ID">
            <span style={{ fontSize: 11, color: 'var(--ant-color-text-description)' }}>
              D:{entry.documentId.slice(0, 8)}
            </span>
          </Tooltip>
        )}
        {hasError && (
          <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
            ERROR
          </Tag>
        )}
        <span
          style={{ fontSize: 11, color: 'var(--ant-color-text-quaternary)', marginLeft: 'auto' }}
        >
          {ts}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {hasDetail && (
            <pre className={styles.logDetail}>{JSON.stringify(entry.detail, null, 2)}</pre>
          )}
          {hasError && <pre className={styles.logError}>{entry.error}</pre>}
        </div>
      )}
    </div>
  )
}
