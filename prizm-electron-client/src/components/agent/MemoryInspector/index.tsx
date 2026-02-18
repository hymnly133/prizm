import { Tag, Tabs, message } from 'antd'
import { Brain, History, ScrollText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { usePrizmContext } from '../../../context/PrizmContext'
import { useScope } from '../../../hooks/useScope'
import type { MemoryItem, DedupLogEntry } from '@prizm/client-core'
import type { SearchMethod, MemoryItemWithGroup } from './types'
import { MemorySearch } from './MemorySearch'
import { MemoryList } from './MemoryList'
import { DedupLog } from './DedupLog'
import { MemoryLogs } from './MemoryLogs'
import { useMemoryStyles } from './styles'
import { ModalSidebar } from '../../ui/ModalSidebar'

export function MemoryInspector({
  externalOpen,
  onExternalClose
}: { externalOpen?: boolean; onExternalClose?: () => void } = {}) {
  const { styles } = useMemoryStyles()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen ?? internalOpen
  const setOpen = onExternalClose
    ? (v: boolean) => {
        if (!v) onExternalClose()
      }
    : setInternalOpen
  const [activeTab, setActiveTab] = useState<'memories' | 'dedup' | 'logs'>('memories')
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

  const handleManualQuery = useCallback(
    (overrideQuery?: string) => {
      void loadMemories(overrideQuery)
    },
    [loadMemories]
  )

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

      <ModalSidebar
        open={open}
        onClose={() => setOpen(false)}
        title={
          <>
            <Brain size={18} />
            Agent 记忆库
          </>
        }
        width={Math.min(900, window.innerWidth * 0.8)}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'memories' | 'dedup' | 'logs')}
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
                  <MemorySearch
                    query={query}
                    setQuery={setQuery}
                    searchMethod={searchMethod}
                    setSearchMethod={setSearchMethod}
                    searchLimit={searchLimit}
                    setSearchLimit={setSearchLimit}
                    useRerank={useRerank}
                    setUseRerank={setUseRerank}
                    filterTypes={filterTypes}
                    setFilterTypes={setFilterTypes}
                    loading={loading}
                    onSearch={handleManualQuery}
                    onRefreshAll={handleRefreshAll}
                  />
                  <div className={styles.partition}>
                    <MemoryList
                      memories={memories}
                      loading={loading}
                      currentScope={currentScope}
                      onDelete={handleDelete}
                    />
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
                    <Tag variant="filled" color="orange" style={{ marginLeft: 2 }}>
                      {dedupEntries.length}
                    </Tag>
                  )}
                </span>
              ),
              children: (
                <DedupLog
                  entries={dedupEntries}
                  loading={dedupLoading}
                  undoingId={undoingId}
                  onRefresh={() => void loadDedupLog()}
                  onUndo={handleUndo}
                />
              )
            },
            {
              key: 'logs',
              label: (
                <span className={styles.tabLabel}>
                  <ScrollText size={14} /> 调试日志
                </span>
              ),
              children: <MemoryLogs open={open && activeTab === 'logs'} />
            }
          ]}
        />
      </ModalSidebar>
    </>
  )
}
