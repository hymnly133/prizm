import { ActionIcon, Modal } from '@lobehub/ui'
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
  Tooltip
} from 'antd'
import { Brain, Trash2, Search, Undo2, History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import type { MemoryItem, DedupLogEntry } from '@prizm/client-core'
import { createStyles } from 'antd-style'

type SearchMethod = 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'

/** 记忆分区：与 MEMORY_SYSTEM 三层一致 */
type MemoryPartition = 'user' | 'scope' | 'session'

const PARTITION_LABELS: Record<MemoryPartition, string> = {
  user: 'User 层（用户画像/偏好）',
  scope: 'Scope 层（工作区叙事/计划/文档记忆）',
  session: 'Session 层（本次会话原子事实）'
}

function getPartition(groupId: string | null | undefined, scope: string): MemoryPartition {
  if (!groupId) return 'user'
  if (groupId === scope || groupId === `${scope}:docs`) return 'scope'
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
    const p = getPartition(m.group_id ?? null, scope)
    if (p === 'user') user.push(m)
    else if (p === 'scope') scopeList.push(m)
    else session.push(m)
  }
  return { user, scope: scopeList, session }
}

/** 统一记忆类型标签 */
const MEMORY_TYPE_LABELS: Record<string, string> = {
  episodic_memory: '情景记忆',
  foresight: '前瞻记忆',
  event_log: '事件日志',
  profile: '用户画像',
  group_profile: '群组画像'
}

/** 记忆类型 → Tag 颜色 */
const MEMORY_TYPE_COLORS: Record<string, string> = {
  episodic_memory: 'blue',
  foresight: 'purple',
  event_log: 'cyan',
  profile: 'gold',
  group_profile: 'orange'
}

/** User 层子类别：按 memory_type 细分 */
const USER_SUBCAT_LABELS: Record<string, string> = {
  profile: '用户画像',
  group_profile: '群组画像'
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

/** Scope 层子类别：先按 group_id 分组（narrative / docs），再按 memory_type 细分 */
function subdivideScope(
  list: MemoryItemWithGroup[],
  scope: string
): { key: string; label: string; list: MemoryItemWithGroup[] }[] {
  const narrativeByType: Record<string, MemoryItemWithGroup[]> = {}
  const docsByType: Record<string, MemoryItemWithGroup[]> = {}

  for (const m of list) {
    const isDoc = m.group_id === `${scope}:docs`
    const type = m.memory_type || 'episodic_memory'
    const target = isDoc ? docsByType : narrativeByType
    if (!target[type]) target[type] = []
    target[type].push(m)
  }

  /** 文档记忆子类型标签 */
  const DOC_TYPE_LABELS: Record<string, string> = {
    episodic_memory: '文档总览',
    event_log: '文档事实',
    foresight: '文档前瞻'
  }

  /** 固定排序：情景 → 前瞻 → 事件日志 → 其它 */
  const TYPE_ORDER = ['episodic_memory', 'foresight', 'event_log']

  const sortedKeys = (obj: Record<string, MemoryItemWithGroup[]>) => {
    const known = TYPE_ORDER.filter((t) => obj[t]?.length)
    const rest = Object.keys(obj).filter((t) => !TYPE_ORDER.includes(t) && obj[t]?.length)
    return [...known, ...rest]
  }

  const out: { key: string; label: string; list: MemoryItemWithGroup[] }[] = []

  for (const type of sortedKeys(narrativeByType)) {
    out.push({
      key: `narrative:${type}`,
      label: MEMORY_TYPE_LABELS[type] || type,
      list: narrativeByType[type]
    })
  }

  for (const type of sortedKeys(docsByType)) {
    out.push({
      key: `docs:${type}`,
      label: DOC_TYPE_LABELS[type] || `文档${MEMORY_TYPE_LABELS[type] || type}`,
      list: docsByType[type]
    })
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
  return Object.entries(bySession).map(([sessionId, items]) => ({
    key: sessionId,
    label: `会话 ${sessionId}`,
    list: items
  }))
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 70vh;
    min-height: 320px;
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
  `
}))

export function MemoryInspector() {
  const { styles } = useStyles()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'memories' | 'dedup'>('memories')
  const [loading, setLoading] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [searchMethod, setSearchMethod] = useState<SearchMethod>('hybrid')
  const [searchLimit, setSearchLimit] = useState<number>(20)
  const [useRerank, setUseRerank] = useState(false)
  const [dedupEntries, setDedupEntries] = useState<DedupLogEntry[]>([])
  const [dedupLoading, setDedupLoading] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const http = manager?.getHttpClient()

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
                  options?: { method?: SearchMethod; limit?: number; use_rerank?: boolean }
                ): Promise<{ enabled: boolean; memories: MemoryItem[] }>
              }
            ).searchMemories(q, currentScope, {
              method: searchMethod,
              limit: searchLimit,
              use_rerank: useRerank
            })
          : await http.getMemories(currentScope)

        if (!res.enabled) {
          setMemories([])
          if (open) message.warning('记忆模块未启用')
        } else {
          setMemories(res.memories)
        }
      } catch (e) {
        if (open) message.error(String(e))
        setMemories([])
      } finally {
        setLoading(false)
      }
    },
    [http, query, currentScope, open, searchMethod, searchLimit, useRerank]
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
      <div
        className="agent-context-preview agent-context-clickable"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'center',
          padding: '8px 0',
          marginTop: 8
        }}
      >
        <Brain size={14} />
        <span>查看/管理记忆库</span>
      </div>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="Agent 记忆库"
        footer={null}
        width={800}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'memories' | 'dedup')}
          items={[
            {
              key: 'memories',
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                        onChange={(e) => setQuery(e.target.value)}
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
                        const {
                          user: userList,
                          scope: scopeList,
                          session: sessionList
                        } = partitionMemories(memories, currentScope)

                        const renderItem = (item: MemoryItemWithGroup) => (
                          <div key={item.id} className={styles.item}>
                            <div style={{ flex: 1 }}>
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
                                  <Tag bordered={false} color="geekblue">
                                    引用: {item.ref_count}次
                                  </Tag>
                                )}
                                {item.last_ref_at && (
                                  <span
                                    title={`最近引用: ${item.last_ref_at}`}
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--ant-color-text-quaternary)'
                                    }}
                                  >
                                    最近引用: {new Date(item.last_ref_at).toLocaleDateString()}
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
                          </div>
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
                          <Collapse
                            defaultActiveKey={['user', 'scope', 'session']}
                            ghost
                            size="small"
                            items={mainItems}
                            className={styles.subCollapse}
                          />
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    <span style={{ fontSize: 13, color: 'var(--ant-color-text-secondary)' }}>
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
      </Modal>
    </>
  )
}
