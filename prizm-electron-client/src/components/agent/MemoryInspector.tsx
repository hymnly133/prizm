import { ActionIcon } from '@lobehub/ui'
import {
  Button,
  Empty,
  Popconfirm,
  Tag,
  Tabs,
  message,
  Input,
  Collapse,
  Select,
  InputNumber,
  Checkbox,
  Tooltip,
  Drawer
} from 'antd'
import { Brain, Trash2, Search, Undo2, History, X } from 'lucide-react'
import { useCallback, useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import type { MemoryItem, DedupLogEntry } from '@prizm/client-core'
import { createStyles } from 'antd-style'
import { EASE_SMOOTH } from '../../theme/motionPresets'

type SearchMethod = 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'

/** 可筛选的记忆类型 */
const MEMORY_TYPE_OPTIONS = [
  { value: 'narrative', label: '叙事记忆' },
  { value: 'foresight', label: '前瞻记忆' },
  { value: 'document', label: '文档记忆' },
  { value: 'event_log', label: '事件日志' },
  { value: 'profile', label: '用户画像' }
]

/** 记忆分区：与 MEMORY_SYSTEM 三层一致 */
type MemoryPartition = 'user' | 'scope' | 'session'

const PARTITION_LABELS: Record<MemoryPartition, string> = {
  user: 'User 层（用户画像/偏好）',
  scope: 'Scope 层（工作区叙事/计划/文档记忆）',
  session: 'Session 层（本次会话原子事实）'
}

function getPartition(item: MemoryItemWithGroup, scope: string): MemoryPartition {
  // 优先使用 memory_layer 字段（新格式）
  if (item.memory_layer === 'user') return 'user'
  if (item.memory_layer === 'scope') return 'scope'
  if (item.memory_layer === 'session') return 'session'
  // 向后兼容：基于 group_id 推断
  const groupId = item.group_id
  if (!groupId || groupId === 'user') return 'user'
  if (groupId.startsWith(`${scope}:session:`)) return 'session'
  return 'scope'
}

/** 带分区的记忆项（列表/搜索 API 可能返回 group_id） */
type MemoryItemWithGroup = MemoryItem & { group_id?: string | null }

function partitionMemories(
  memories: MemoryItemWithGroup[],
  scope: string
): Record<MemoryPartition, MemoryItemWithGroup[]> {
  const user: MemoryItemWithGroup[] = []
  const scopeList: MemoryItemWithGroup[] = []
  const session: MemoryItemWithGroup[] = []
  for (const m of memories) {
    const p = getPartition(m, scope)
    if (p === 'user') user.push(m)
    else if (p === 'scope') scopeList.push(m)
    else session.push(m)
  }
  return { user, scope: scopeList, session }
}

/** 统一记忆类型标签 */
const MEMORY_TYPE_LABELS: Record<string, string> = {
  narrative: '叙事记忆',
  foresight: '前瞻记忆',
  document: '文档记忆',
  event_log: '事件日志',
  profile: '用户画像'
}

/** 记忆类型 → Tag 颜色 */
const MEMORY_TYPE_COLORS: Record<string, string> = {
  narrative: 'blue',
  foresight: 'purple',
  document: 'green',
  event_log: 'cyan',
  profile: 'gold'
}

/** 文档子类型标签 */
const DOC_SUB_TYPE_LABELS: Record<string, string> = {
  overview: '总览',
  fact: '事实',
  migration: '变更'
}

/** 记忆来源标签 */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  conversation: '对话',
  document: '文档',
  compression: '压缩',
  manual: '手动'
}

/** User 层子类别：按 memory_type 细分 */
const USER_SUBCAT_LABELS: Record<string, string> = {
  profile: '用户画像'
}

function subdivideUser(
  list: MemoryItemWithGroup[]
): { key: string; label: string; list: MemoryItemWithGroup[] }[] {
  const byKey: Record<string, MemoryItemWithGroup[]> = {}
  for (const m of list) {
    const key = m.memory_type && USER_SUBCAT_LABELS[m.memory_type] ? m.memory_type : 'profile'
    if (!byKey[key]) byKey[key] = []
    byKey[key].push(m)
  }
  return Object.entries(byKey).map(([key, items]) => ({
    key,
    label: USER_SUBCAT_LABELS[key] ?? '用户画像',
    list: items
  }))
}

/** Scope 层子类别：按 memory_type 分组，document 类型下按 sub_type 二级分组 */
function subdivideScope(
  list: MemoryItemWithGroup[],
  _scope: string
): { key: string; label: string; list: MemoryItemWithGroup[] }[] {
  const byType: Record<string, MemoryItemWithGroup[]> = {}

  for (const m of list) {
    const type = m.memory_type || 'narrative'
    if (!byType[type]) byType[type] = []
    byType[type].push(m)
  }

  /** 固定排序 */
  const TYPE_ORDER = ['narrative', 'foresight', 'document', 'event_log']

  const sortedKeys = Object.keys(byType).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a)
    const bi = TYPE_ORDER.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  const out: { key: string; label: string; list: MemoryItemWithGroup[] }[] = []

  for (const type of sortedKeys) {
    if (type === 'document') {
      // 文档记忆按 sub_type 细分
      const bySubType: Record<string, MemoryItemWithGroup[]> = {}
      for (const m of byType[type]) {
        const sub = (m as any).sub_type || 'overview'
        if (!bySubType[sub]) bySubType[sub] = []
        bySubType[sub].push(m)
      }
      const subOrder = ['overview', 'fact', 'migration']
      const sortedSubs = Object.keys(bySubType).sort((a, b) => {
        const ai = subOrder.indexOf(a)
        const bi = subOrder.indexOf(b)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
      for (const sub of sortedSubs) {
        out.push({
          key: `document:${sub}`,
          label: `文档${DOC_SUB_TYPE_LABELS[sub] || sub}（${bySubType[sub].length}）`,
          list: bySubType[sub]
        })
      }
    } else {
      out.push({
        key: type,
        label: MEMORY_TYPE_LABELS[type] || type,
        list: byType[type]
      })
    }
  }

  return out
}

/** Session 层子类别：按 sessionId 细分（group_id = scope:session:id） */
function subdivideSession(
  list: MemoryItemWithGroup[],
  scope: string
): { key: string; label: string; list: MemoryItemWithGroup[] }[] {
  const prefix = `${scope}:session:`
  const bySession: Record<string, MemoryItemWithGroup[]> = {}
  for (const m of list) {
    const g = m.group_id ?? ''
    const sessionId = g.startsWith(prefix) ? g.slice(prefix.length) || 'default' : 'default'
    if (!bySession[sessionId]) bySession[sessionId] = []
    bySession[sessionId].push(m)
  }
  const entries = Object.entries(bySession)
  entries.sort((a, b) => {
    const aTime = a[1][0]?.created_at ?? ''
    const bTime = b[1][0]?.created_at ?? ''
    return bTime.localeCompare(aTime)
  })
  return entries.map(([sessionId, items], idx) => ({
    key: sessionId,
    label: `会话 #${entries.length - idx} (${
      sessionId.length > 8 ? sessionId.slice(0, 8) + '…' : sessionId
    }) · ${items.length} 条`,
    list: items
  }))
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 16px;
  `,
  header: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,
  querySection: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-shrink: 0;
  `,
  queryRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  queryInput: css`
    flex: 1;
    min-width: 0;
  `,
  advancedRow: css`
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  `,
  advancedLabel: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  list: css`
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 4px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    padding: 8px;
  `,
  item: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    transition: background 0.2s;
    gap: 12px;
    flex-shrink: 0;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  content: css`
    flex: 1;
    min-width: 0;
    font-size: 14px;
    line-height: 1.5;
    color: ${token.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  meta: css`
    display: flex;
    gap: 8px;
    margin-top: 8px;
    font-size: 12px;
    color: ${token.colorTextDescription};
    align-items: center;
  `,
  actions: css`
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    color: ${token.colorTextQuaternary};
  `,
  partition: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
    margin: 0 -4px 0 0;
  `,
  partitionSection: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  `,
  partitionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    padding: 6px 0;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  partitionList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  emptySection: css`
    padding: 12px;
    font-size: 13px;
    color: ${token.colorTextQuaternary};
  `,
  subCollapse: css`
    .ant-collapse-item {
      border-bottom: none !important;
    }
    .ant-collapse-header {
      padding: 6px 0 6px 8px !important;
      min-height: auto !important;
    }
    .ant-collapse-content-box {
      padding: 6px 0 6px 16px !important;
    }
  `,
  subCategoryHeader: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextTertiary};
  `,
  dedupItem: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: ${token.colorFillQuaternary};
    border-radius: ${token.borderRadius}px;
    transition: background 0.2s;
    flex-shrink: 0;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  dedupHeader: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  `,
  dedupMemoryPair: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    line-height: 1.5;
  `,
  dedupLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  dedupContent: css`
    color: ${token.colorText};
    word-break: break-word;
    white-space: pre-wrap;
    padding-left: 8px;
    border-left: 2px solid ${token.colorBorderSecondary};
  `,
  dedupMeta: css`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    color: ${token.colorTextDescription};
    align-items: center;
  `,
  triggerButton: css`
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    padding: 10px 16px;
    width: 100%;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 8px;

    &:hover {
      border-color: ${token.colorPrimaryBorder};
      color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  drawerTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  `,
  tabsWrap: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  tabLabel: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  summaryBar: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;
    color: ${token.colorTextDescription};
    flex-shrink: 0;
  `,
  smallTag: css`
    font-size: 11px;
  `,
  updatedAt: css`
    font-size: 11px;
    color: ${token.colorTextQuaternary};
  `,
  dedupHintText: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `
}))

export function MemoryInspector({
  externalOpen,
  onExternalClose
}: { externalOpen?: boolean; onExternalClose?: () => void } = {}) {
  const { styles } = useStyles()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen ?? internalOpen
  const setOpen = onExternalClose
    ? (v: boolean) => {
        if (!v) onExternalClose()
      }
    : setInternalOpen
  const [activeTab, setActiveTab] = useState<'memories' | 'dedup'>('memories')
  const [loading, setLoading] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [searchMethod, setSearchMethod] = useState<SearchMethod>('hybrid')
  const [searchLimit, setSearchLimit] = useState<number>(20)
  const [useRerank, setUseRerank] = useState(false)
  const [filterTypes, setFilterTypes] = useState<string[]>([])
  const [dedupEntries, setDedupEntries] = useState<DedupLogEntry[]>([])
  const [dedupLoading, setDedupLoading] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const http = manager?.getHttpClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadMemories = useCallback(
    async (overrideQuery?: string) => {
      if (!http) return
      const q = (overrideQuery ?? query).trim()
      setLoading(true)
      try {
        const res = q
          ? await (
              http as typeof http & {
                searchMemories(
                  query: string,
                  scope?: string,
                  options?: {
                    method?: SearchMethod
                    limit?: number
                    use_rerank?: boolean
                    memory_types?: string[]
                  }
                ): Promise<{ enabled: boolean; memories: MemoryItem[] }>
              }
            ).searchMemories(q, currentScope, {
              method: searchMethod,
              limit: searchLimit,
              use_rerank: useRerank,
              memory_types: filterTypes.length > 0 ? filterTypes : undefined
            })
          : await http.getMemories(currentScope)

        if (!res.enabled) {
          setMemories([])
          if (open) message.warning('记忆模块未启用')
        } else {
          // 客户端侧按类型过滤（全量列表无服务端过滤时）
          const filtered =
            !q && filterTypes.length > 0
              ? res.memories.filter(
                  (m: MemoryItemWithGroup) => m.memory_type && filterTypes.includes(m.memory_type)
                )
              : res.memories
          setMemories(filtered)
        }
      } catch (e) {
        if (open) message.error(String(e))
        setMemories([])
      } finally {
        setLoading(false)
      }
    },
    [http, query, currentScope, open, searchMethod, searchLimit, useRerank, filterTypes]
  )

  const handleManualQuery = useCallback(() => {
    void loadMemories()
  }, [loadMemories])

  const handleRefreshAll = useCallback(() => {
    setQuery('')
    setTimeout(() => void loadMemories(''), 0)
  }, [loadMemories])

  useEffect(() => {
    if (open) void loadMemories('')
  }, [open, currentScope, loadMemories])

  const handleDelete = async (id: string) => {
    if (!http) return
    try {
      await http.deleteMemory(id, currentScope)
      message.success('已删除')
      void loadMemories()
    } catch (e) {
      message.error(String(e))
    }
  }

  const loadDedupLog = useCallback(async () => {
    if (!http) return
    setDedupLoading(true)
    try {
      const res = await http.getDedupLog(currentScope, 50)
      setDedupEntries(res.entries ?? [])
    } catch (e) {
      message.error(String(e))
      setDedupEntries([])
    } finally {
      setDedupLoading(false)
    }
  }, [http, currentScope])

  const handleUndo = async (dedupLogId: string) => {
    if (!http) return
    setUndoingId(dedupLogId)
    try {
      const res = await http.undoDedup(dedupLogId, currentScope)
      if (res.restored) {
        message.success('已恢复被去重的记忆')
        void loadDedupLog()
        void loadMemories()
      } else {
        message.warning('回退失败：可能已回退过或记录不存在')
      }
    } catch (e) {
      message.error(String(e))
    } finally {
      setUndoingId(null)
    }
  }

  useEffect(() => {
    if (open && activeTab === 'dedup') void loadDedupLog()
  }, [open, activeTab, currentScope, loadDedupLog])

  return (
    <>
      {/* Trigger button — only rendered when not externally controlled */}
      {externalOpen == null && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          className={styles.triggerButton}
        >
          <Brain size={14} />
          <span>查看/管理记忆库</span>
        </button>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className={styles.drawerTitle}>
            <Brain size={18} />
            Agent 记忆库
          </span>
        }
        width={Math.min(900, window.innerWidth * 0.8)}
        placement="right"
        styles={{
          body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'memories' | 'dedup')}
          className={styles.tabsWrap}
          tabBarStyle={{ padding: '0 16px', marginBottom: 0 }}
          items={[
            {
              key: 'memories',
              label: (
                <span className={styles.tabLabel}>
                  <Brain size={14} /> 记忆列表
                </span>
              ),
              children: (
                <div className={styles.container}>
                  <div className={styles.querySection}>
                    <div className={styles.queryRow}>
                      <Input
                        className={styles.queryInput}
                        placeholder="输入关键词或描述进行记忆查询（留空则列出全部）"
                        value={query}
                        onChange={(e) => {
                          const v = e.target.value
                          setQuery(v)
                          if (debounceRef.current) clearTimeout(debounceRef.current)
                          debounceRef.current = setTimeout(() => {
                            if (v.trim()) void loadMemories(v)
                          }, 300)
                        }}
                        onPressEnter={() => handleManualQuery()}
                        allowClear
                      />
                      <Button
                        type="primary"
                        icon={<Search size={14} />}
                        loading={loading}
                        onClick={handleManualQuery}
                      >
                        查询
                      </Button>
                      <Button onClick={handleRefreshAll} loading={loading} disabled={loading}>
                        刷新全部
                      </Button>
                    </div>
                    <Collapse
                      ghost
                      size="small"
                      items={[
                        {
                          key: 'advanced',
                          label: '高级选项',
                          children: (
                            <div className={styles.advancedRow}>
                              <span className={styles.advancedLabel}>检索方式</span>
                              <Select<SearchMethod>
                                size="small"
                                value={searchMethod}
                                onChange={setSearchMethod}
                                style={{ width: 120 }}
                                options={[
                                  { value: 'keyword', label: '关键词' },
                                  { value: 'vector', label: '向量' },
                                  { value: 'hybrid', label: '混合(默认)' },
                                  { value: 'rrf', label: 'RRF' },
                                  { value: 'agentic', label: 'Agentic' }
                                ]}
                              />
                              <span className={styles.advancedLabel}>条数</span>
                              <InputNumber
                                size="small"
                                min={1}
                                max={100}
                                value={searchLimit}
                                onChange={(v) => v != null && setSearchLimit(v)}
                                style={{ width: 72 }}
                              />
                              <Checkbox
                                checked={useRerank}
                                onChange={(e) => setUseRerank(e.target.checked)}
                              >
                                精排
                              </Checkbox>
                              <span className={styles.advancedLabel}>类型</span>
                              <Select
                                size="small"
                                mode="multiple"
                                value={filterTypes}
                                onChange={(v) => setFilterTypes(v)}
                                style={{ minWidth: 160, flex: 1 }}
                                placeholder="全部类型"
                                allowClear
                                maxTagCount={2}
                                options={MEMORY_TYPE_OPTIONS}
                              />
                            </div>
                          )
                        }
                      ]}
                    />
                  </div>

                  <div className={styles.partition}>
                    {loading ? (
                      <div className={styles.empty}>加载中...</div>
                    ) : memories.length === 0 ? (
                      <div className={styles.empty}>
                        <Empty description="暂无记忆" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </div>
                    ) : (
                      (() => {
                        const totalCount = memories.length
                        const {
                          user: userList,
                          scope: scopeList,
                          session: sessionList
                        } = partitionMemories(memories, currentScope)

                        const renderItem = (item: MemoryItemWithGroup) => (
                          <motion.div
                            key={item.id}
                            className={styles.item}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className={styles.content}>{item.memory}</div>
                              <div className={styles.meta}>
                                {item.memory_type && (
                                  <Tag
                                    bordered={false}
                                    color={MEMORY_TYPE_COLORS[item.memory_type] ?? 'default'}
                                  >
                                    {MEMORY_TYPE_LABELS[item.memory_type] ?? item.memory_type}
                                  </Tag>
                                )}
                                {(item as any).sub_type && (
                                  <Tag bordered={false} color="lime">
                                    {DOC_SUB_TYPE_LABELS[(item as any).sub_type] ??
                                      (item as any).sub_type}
                                  </Tag>
                                )}
                                {(item as any).source_type && (
                                  <Tag bordered={false} className={styles.smallTag}>
                                    来源:{' '}
                                    {SOURCE_TYPE_LABELS[(item as any).source_type] ??
                                      (item as any).source_type}
                                  </Tag>
                                )}
                                <span title={item.created_at}>
                                  {item.created_at
                                    ? new Date(item.created_at).toLocaleString()
                                    : '未知时间'}
                                </span>
                                {item.score != null && (
                                  <Tag bordered={false}>
                                    相似度: {Number(item.score).toFixed(2)}
                                  </Tag>
                                )}
                                {item.ref_count != null && item.ref_count > 0 && (
                                  <Tooltip
                                    title={
                                      item.last_ref_at
                                        ? `最近引用: ${new Date(item.last_ref_at).toLocaleString()}`
                                        : undefined
                                    }
                                  >
                                    <Tag
                                      bordered={false}
                                      color="geekblue"
                                      style={{ cursor: item.last_ref_at ? 'help' : undefined }}
                                    >
                                      引用 {item.ref_count}次
                                    </Tag>
                                  </Tooltip>
                                )}
                                {item.updated_at && item.updated_at !== item.created_at && (
                                  <span
                                    title={`更新于: ${item.updated_at}`}
                                    className={styles.updatedAt}
                                  >
                                    更新: {new Date(item.updated_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={styles.actions}>
                              <Popconfirm
                                title="确定删除这条记忆吗？"
                                onConfirm={() => handleDelete(item.id)}
                                okText="删除"
                                cancelText="取消"
                              >
                                <ActionIcon icon={Trash2} size="small" title="删除" />
                              </Popconfirm>
                            </div>
                          </motion.div>
                        )

                        const renderSubList = (
                          subs: { key: string; label: string; list: MemoryItemWithGroup[] }[]
                        ) =>
                          subs.length === 0 ? (
                            <div className={styles.emptySection}>暂无</div>
                          ) : (
                            <Collapse
                              ghost
                              size="small"
                              defaultActiveKey={subs.map((s) => s.key)}
                              className={styles.subCollapse}
                              items={subs.map((sub) => ({
                                key: sub.key,
                                label: (
                                  <span className={styles.subCategoryHeader}>
                                    {sub.label}（{sub.list.length}）
                                  </span>
                                ),
                                children: (
                                  <div className={styles.partitionList}>
                                    {sub.list.map((item) => renderItem(item))}
                                  </div>
                                )
                              }))}
                            />
                          )

                        const userSubs = subdivideUser(userList)
                        const scopeSubs = subdivideScope(scopeList, currentScope)
                        const sessionSubs = subdivideSession(sessionList, currentScope)

                        const mainItems: {
                          key: string
                          label: ReactNode
                          children: ReactNode
                        }[] = [
                          {
                            key: 'user',
                            label: `${PARTITION_LABELS.user}（${userList.length}）`,
                            children:
                              userList.length === 0 ? (
                                <div className={styles.emptySection}>暂无</div>
                              ) : (
                                renderSubList(userSubs)
                              )
                          },
                          {
                            key: 'scope',
                            label: `${PARTITION_LABELS.scope}（${scopeList.length}）`,
                            children:
                              scopeList.length === 0 ? (
                                <div className={styles.emptySection}>暂无</div>
                              ) : (
                                renderSubList(scopeSubs)
                              )
                          },
                          {
                            key: 'session',
                            label: `${PARTITION_LABELS.session}（${sessionList.length}）`,
                            children:
                              sessionList.length === 0 ? (
                                <div className={styles.emptySection}>暂无</div>
                              ) : (
                                renderSubList(sessionSubs)
                              )
                          }
                        ]

                        return (
                          <>
                            <div className={styles.summaryBar}>
                              <span>共 {totalCount} 条记忆</span>
                              {userList.length > 0 && (
                                <Tag bordered={false} color="gold" className={styles.smallTag}>
                                  User {userList.length}
                                </Tag>
                              )}
                              {scopeList.length > 0 && (
                                <Tag bordered={false} color="blue" className={styles.smallTag}>
                                  Scope {scopeList.length}
                                </Tag>
                              )}
                              {sessionList.length > 0 && (
                                <Tag bordered={false} color="cyan" className={styles.smallTag}>
                                  Session {sessionList.length}
                                </Tag>
                              )}
                            </div>
                            <Collapse
                              defaultActiveKey={['user', 'scope', 'session']}
                              ghost
                              size="small"
                              items={mainItems}
                              className={styles.subCollapse}
                            />
                          </>
                        )
                      })()
                    )}
                  </div>
                </div>
              )
            },
            {
              key: 'dedup',
              label: (
                <span className={styles.tabLabel}>
                  <History size={14} /> 去重日志
                  {dedupEntries.length > 0 && (
                    <Tag bordered={false} color="orange" style={{ marginLeft: 2 }}>
                      {dedupEntries.length}
                    </Tag>
                  )}
                </span>
              ),
              children: (
                <div className={styles.container}>
                  <div className={styles.header}>
                    <span className={styles.dedupHintText}>
                      当记忆被判定为重复时，系统会抑制新记忆并保留已有记忆。你可以在此查看并回退。
                    </span>
                    <Button size="small" onClick={() => void loadDedupLog()} loading={dedupLoading}>
                      刷新
                    </Button>
                  </div>

                  <div className={styles.partition}>
                    {dedupLoading ? (
                      <div className={styles.empty}>加载中...</div>
                    ) : dedupEntries.length === 0 ? (
                      <div className={styles.empty}>
                        <Empty description="暂无去重记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </div>
                    ) : (
                      dedupEntries.map((entry) => (
                        <div key={entry.id} className={styles.dedupItem}>
                          <div className={styles.dedupHeader}>
                            <div className={styles.dedupMemoryPair}>
                              <div>
                                <span className={styles.dedupLabel}>已保留</span>
                                <div className={styles.dedupContent}>
                                  {entry.kept_memory_content || '(内容不可用)'}
                                </div>
                              </div>
                              <div>
                                <span className={styles.dedupLabel}>被抑制（新）</span>
                                <div className={styles.dedupContent}>
                                  {entry.new_memory_content}
                                </div>
                              </div>
                            </div>
                            <div className={styles.actions}>
                              <Popconfirm
                                title="恢复被抑制的记忆？"
                                description="这将重新插入被去重的记忆到记忆库中。"
                                onConfirm={() => handleUndo(entry.id)}
                                okText="恢复"
                                cancelText="取消"
                              >
                                <Tooltip title="恢复被抑制的记忆">
                                  <ActionIcon
                                    icon={Undo2}
                                    size="small"
                                    loading={undoingId === entry.id}
                                  />
                                </Tooltip>
                              </Popconfirm>
                            </div>
                          </div>
                          <div className={styles.dedupMeta}>
                            <Tag bordered={false} color="blue">
                              {entry.new_memory_type}
                            </Tag>
                            {entry.text_similarity != null &&
                              Number(entry.text_similarity) >= 0 && (
                                <Tooltip title={`文本相似度分数 (Dice/Jaccard max)`}>
                                  <Tag bordered={false} color="cyan" style={{ cursor: 'help' }}>
                                    文本: {Number(entry.text_similarity).toFixed(3)}
                                  </Tag>
                                </Tooltip>
                              )}
                            {entry.vector_distance != null &&
                              Number(entry.vector_distance) >= 0 && (
                                <Tooltip title={`向量 L2 距离（越小越相似）`}>
                                  <Tag bordered={false} color="geekblue" style={{ cursor: 'help' }}>
                                    向量: {Number(entry.vector_distance).toFixed(3)}
                                  </Tag>
                                </Tooltip>
                              )}
                            {entry.llm_reasoning && (
                              <Tooltip title={entry.llm_reasoning}>
                                <Tag bordered={false} color="purple" style={{ cursor: 'help' }}>
                                  LLM 判定
                                </Tag>
                              </Tooltip>
                            )}
                            <span>
                              {entry.created_at
                                ? new Date(entry.created_at).toLocaleString()
                                : '未知时间'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            }
          ]}
        />
      </Drawer>
    </>
  )
}
