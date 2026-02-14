import { ActionIcon, Modal } from '@lobehub/ui'
import {
  Button,
  Empty,
  Popconfirm,
  Tag,
  message,
  Input,
  Collapse,
  Select,
  InputNumber,
  Checkbox
} from 'antd'
import { Brain, Trash2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { usePrizmContext } from '../../context/PrizmContext'
import { useScope } from '../../hooks/useScope'
import type { MemoryItem } from '@prizm/client-core'
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

/** Scope 层子类别：按 group_id 细分 scope vs scope:docs */
function subdivideScope(
  list: MemoryItemWithGroup[],
  scope: string
): { key: string; label: string; list: MemoryItemWithGroup[] }[] {
  const narrative: MemoryItemWithGroup[] = []
  const docs: MemoryItemWithGroup[] = []
  for (const m of list) {
    if (m.group_id === `${scope}:docs`) docs.push(m)
    else narrative.push(m)
  }
  const out: { key: string; label: string; list: MemoryItemWithGroup[] }[] = []
  if (narrative.length) out.push({ key: 'narrative', label: '工作区叙事/计划', list: narrative })
  if (docs.length) out.push({ key: 'docs', label: '文档记忆', list: docs })
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
  `
}))

export function MemoryInspector() {
  const { styles } = useStyles()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [searchMethod, setSearchMethod] = useState<SearchMethod>('hybrid')
  const [searchLimit, setSearchLimit] = useState<number>(20)
  const [useRerank, setUseRerank] = useState(false)
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
  }, [open])

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
                        <span title={item.created_at}>
                          {item.created_at
                            ? new Date(item.created_at).toLocaleString()
                            : '未知时间'}
                        </span>
                        {item.score != null && (
                          <Tag bordered={false}>相似度: {Number(item.score).toFixed(2)}</Tag>
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

                const mainItems: { key: string; label: ReactNode; children: ReactNode }[] = [
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
      </Modal>
    </>
  )
}
