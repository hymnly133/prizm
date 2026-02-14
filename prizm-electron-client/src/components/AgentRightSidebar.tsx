/**
 * Agent 右侧边栏 - 显示状态、上下文、文档、工具调用等
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@lobehub/ui'
import { Select } from './ui/Select'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import type {
  Document,
  AgentSession,
  AgentMessage,
  ToolCallRecord,
  AvailableModel
} from '@prizm/client-core'
import {
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Wrench,
  History,
  ListChecks
} from 'lucide-react'

interface AgentRightSidebarProps {
  sending?: boolean
  error?: string | null
  currentSession?: AgentSession | null
  optimisticMessages?: AgentMessage[]
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
}

export function AgentRightSidebar({
  sending,
  error,
  currentSession,
  optimisticMessages = [],
  selectedModel,
  onModelChange
}: AgentRightSidebarProps) {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()

  const [models, setModels] = useState<AvailableModel[]>([])
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [scopeContext, setScopeContext] = useState<string>('')
  const [scopeContextLoading, setScopeContextLoading] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [sessionContext, setSessionContext] = useState<{
    provisions: { itemId: string; kind: string; mode: string; charCount: number; stale: boolean }[]
    modifications: { itemId: string; type: string; action: string; timestamp: number }[]
  } | null>(null)
  const [sessionContextLoading, setSessionContextLoading] = useState(false)

  const loadScopeContext = useCallback(async () => {
    if (!http || !currentScope) return
    setScopeContextLoading(true)
    try {
      const res = await http.getAgentScopeContext(currentScope)
      setScopeContext(res.summary || '')
    } catch {
      setScopeContext('')
    } finally {
      setScopeContextLoading(false)
    }
  }, [http, currentScope])

  const loadDocuments = useCallback(async () => {
    if (!http || !currentScope) return
    setDocumentsLoading(true)
    try {
      const docs = await http.listDocuments({ scope: currentScope })
      setDocuments(docs || [])
    } catch {
      setDocuments([])
    } finally {
      setDocumentsLoading(false)
    }
  }, [http, currentScope])

  const loadModels = useCallback(async () => {
    if (!http) return
    try {
      const [modelsRes, tools] = await Promise.all([http.getAgentModels(), http.getAgentTools()])
      setModels(modelsRes.models ?? [])
      setDefaultModel(tools.agent?.defaultModel ?? '')
    } catch {
      setModels([])
      setDefaultModel('')
    }
  }, [http])

  const loadSessionContext = useCallback(async () => {
    if (!http || !currentScope || !currentSession?.id) return
    setSessionContextLoading(true)
    try {
      const ctx = await (
        http as {
          getAgentSessionContext: (
            id: string,
            scope: string
          ) => Promise<{
            provisions: {
              itemId: string
              kind: string
              mode: string
              charCount: number
              stale: boolean
            }[]
            modifications: { itemId: string; type: string; action: string; timestamp: number }[]
          }>
        }
      ).getAgentSessionContext(currentSession.id, currentScope)
      setSessionContext({
        provisions: (ctx.provisions ?? []) as {
          itemId: string
          kind: string
          mode: string
          charCount: number
          stale: boolean
        }[],
        modifications: (ctx.modifications ?? []) as {
          itemId: string
          type: string
          action: string
          timestamp: number
        }[]
      })
    } catch {
      setSessionContext(null)
    } finally {
      setSessionContextLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  useEffect(() => {
    void loadScopeContext()
    void loadDocuments()
  }, [loadScopeContext, loadDocuments])

  useEffect(() => {
    if (currentSession?.id && currentScope) void loadSessionContext()
    else setSessionContext(null)
  }, [currentSession?.id, currentScope, loadSessionContext])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  /** 当前会话中最后一条 assistant 消息的 toolCalls（含乐观更新） */
  const latestToolCalls: ToolCallRecord[] = useMemo(() => {
    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...(currentSession?.messages ?? []),
      ...optimisticMessages
    ]
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const raw = Array.isArray(lastAssistant?.toolCalls) ? lastAssistant.toolCalls : []
    return raw.filter(
      (t): t is ToolCallRecord =>
        t != null &&
        typeof t === 'object' &&
        typeof (t as ToolCallRecord).id === 'string' &&
        typeof (t as ToolCallRecord).name === 'string' &&
        typeof (t as ToolCallRecord).result === 'string'
    )
  }, [currentSession?.messages, optimisticMessages])

  return (
    <aside className="agent-right-sidebar">
      <div className="agent-right-sidebar-header">
        <span className="agent-right-sidebar-title">Agent 状态</span>
      </div>

      <div className="agent-right-sidebar-body">
        {/* 模型选择 */}
        {onModelChange && (
          <section className="agent-right-section">
            <h3 className="agent-right-section-title">模型</h3>
            <Select
              options={[
                { label: defaultModel ? `默认 (${defaultModel})` : '默认', value: '' },
                ...models.map((m) => ({ label: m.label, value: m.id }))
              ]}
              value={selectedModel ?? ''}
              onChange={(v) => onModelChange(v || undefined)}
              style={{ width: '100%' }}
            />
          </section>
        )}

        {/* 状态 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">状态</h3>
          <div className="agent-status-row">
            {sending ? (
              <>
                <Loader2 className="agent-status-icon spinning" size={14} />
                <span>生成中</span>
              </>
            ) : error ? (
              <>
                <AlertCircle className="agent-status-icon error" size={14} />
                <span className="agent-status-error">{error}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="agent-status-icon idle" size={14} />
                <span>就绪</span>
              </>
            )}
          </div>
        </section>

        {/* 工作区上下文 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">工作区上下文</h3>
          <div
            className="agent-context-preview agent-context-clickable"
            role="button"
            tabIndex={0}
            onClick={() => scopeContext && setContextModalOpen(true)}
            onKeyDown={(e) =>
              scopeContext && (e.key === 'Enter' || e.key === ' ') && setContextModalOpen(true)
            }
            aria-label="点击查看完整上下文"
          >
            {scopeContextLoading ? (
              <div className="agent-right-loading">
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </div>
            ) : scopeContext ? (
              <>
                <pre className="agent-context-text">{scopeContext}</pre>
                <span className="agent-context-click-hint">点击查看完整预览</span>
              </>
            ) : (
              <p className="agent-right-empty">当前 scope 无便签/待办/文档</p>
            )}
          </div>
          <button
            type="button"
            className="agent-right-refresh"
            onClick={loadScopeContext}
            disabled={scopeContextLoading}
          >
            刷新
          </button>
          <Modal
            open={contextModalOpen}
            onCancel={() => setContextModalOpen(false)}
            title="工作区上下文完整预览"
            footer={null}
            width={640}
            styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
          >
            <pre className="agent-context-modal-text">{scopeContext}</pre>
          </Modal>
        </section>

        {/* 文档列表与状态 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">文档</h3>
          <div className="agent-documents-list">
            {documentsLoading ? (
              <div className="agent-right-loading">
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </div>
            ) : documents.length === 0 ? (
              <p className="agent-right-empty">暂无文档</p>
            ) : (
              <ul className="agent-documents-ul">
                {documents.map((doc) => (
                  <li key={doc.id} className="agent-document-item">
                    <FileText size={12} className="agent-doc-icon" />
                    <div className="agent-document-info">
                      <span className="agent-document-title" title={doc.title}>
                        {doc.title || '未命名'}
                      </span>
                      <span
                        className="agent-document-status"
                        title={doc.llmSummary ? '已有摘要' : '摘要待生成'}
                      >
                        {doc.llmSummary ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                        {doc.llmSummary ? '摘要已生成' : '摘要待生成'}
                      </span>
                      {doc.llmSummary && (
                        <span className="agent-document-desc" title={doc.llmSummary}>
                          {doc.llmSummary.length > 60
                            ? `${doc.llmSummary.slice(0, 60)}…`
                            : doc.llmSummary}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="agent-right-refresh"
            onClick={loadDocuments}
            disabled={documentsLoading}
          >
            刷新
          </button>
        </section>

        {/* 上下文状态：本会话已提供的项 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <ListChecks size={14} className="agent-right-section-icon" />
            上下文状态
          </h3>
          {!currentSession ? (
            <p className="agent-right-empty">选择会话后显示</p>
          ) : sessionContextLoading ? (
            <div className="agent-right-loading">
              <Loader2 size={14} className="spinning" />
              <span>加载中</span>
            </div>
          ) : !sessionContext?.provisions?.length ? (
            <p className="agent-right-empty">本会话尚未引用或提供工作区项</p>
          ) : (
            <ul className="agent-tool-calls-list">
              {sessionContext.provisions.slice(0, 10).map((p, i) => (
                <li key={`${p.itemId}-${i}`} className="agent-tool-call-item">
                  <span className="agent-tool-call-name">
                    {p.kind}:{p.itemId.slice(0, 8)}
                  </span>
                  <span className="text-zinc-500 text-xs">
                    {p.mode} · {p.charCount} 字{p.stale ? ' · 已过期' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {currentSession && (
            <button
              type="button"
              className="agent-right-refresh"
              onClick={loadSessionContext}
              disabled={sessionContextLoading}
            >
              刷新
            </button>
          )}
        </section>

        {/* 修改记录：本会话内 Agent 对工作区的修改 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <History size={14} className="agent-right-section-icon" />
            修改记录
          </h3>
          {!currentSession ? (
            <p className="agent-right-empty">选择会话后显示</p>
          ) : sessionContextLoading ? (
            <div className="agent-right-loading">
              <Loader2 size={14} className="spinning" />
              <span>加载中</span>
            </div>
          ) : !sessionContext?.modifications?.length ? (
            <p className="agent-right-empty">本会话暂无修改记录</p>
          ) : (
            <ul className="agent-tool-calls-list">
              {sessionContext.modifications.map((m, i) => (
                <li key={`${m.itemId}-${m.timestamp}-${i}`} className="agent-tool-call-item">
                  <span className="agent-tool-call-name">
                    {m.action} {m.type}:{m.itemId.slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 工具调用 */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">工具调用</h3>
          {latestToolCalls.length === 0 ? (
            <p className="agent-right-empty">当前回复暂无工具调用</p>
          ) : (
            <ul className="agent-tool-calls-list">
              {latestToolCalls.map((tc) => (
                <li
                  key={tc.id}
                  className={`agent-tool-call-item ${tc.isError ? 'error' : ''}`}
                  title={tc.result}
                >
                  <div className="agent-tool-call-header">
                    <Wrench size={12} className="agent-tool-call-icon" />
                    <span className="agent-tool-call-name">{tc.name}</span>
                  </div>
                  <pre className="agent-tool-call-args">{tc.arguments || '{}'}</pre>
                  <pre className="agent-tool-call-result">{tc.result}</pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}
