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
import { getToolDisplayName } from '@prizm/client-core'

/** Scope 交互记录（与 API 返回一致） */
interface ScopeInteractionItem {
  toolName: string
  action: string
  itemKind?: string
  itemId?: string
  title?: string
  timestamp?: number
}
import {
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Wrench,
  History,
  ListChecks,
  MessageSquare,
  BookOpen,
  PlusCircle,
  Pencil,
  Trash2,
  Search
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
    scopeInteractions: ScopeInteractionItem[]
  } | null>(null)
  const [sessionContextLoading, setSessionContextLoading] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false)

  const loadSystemPrompt = useCallback(async () => {
    if (!http || !currentScope) return
    setSystemPromptLoading(true)
    try {
      const res = await http.getAgentSystemPrompt(currentScope, currentSession?.id)
      setSystemPrompt(res.systemPrompt || '')
    } catch {
      setSystemPrompt('')
    } finally {
      setSystemPromptLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

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
      const ctx = await http.getAgentSessionContext(currentSession.id, currentScope)
      setSessionContext({
        provisions: ctx.provisions ?? [],
        modifications: ctx.modifications ?? [],
        scopeInteractions:
          (ctx as { scopeInteractions?: ScopeInteractionItem[] }).scopeInteractions ?? []
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
    void loadSystemPrompt()
  }, [loadScopeContext, loadDocuments, loadSystemPrompt])

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

        {/* 系统提示词（用户发送消息前注入的完整前置提示词） */}
        <section className="agent-right-section">
          <h3 className="agent-right-section-title">
            <MessageSquare size={14} className="agent-right-section-icon" />
            系统提示词
          </h3>
          <div
            className="agent-context-preview agent-context-clickable"
            role="button"
            tabIndex={0}
            onClick={() => systemPrompt && setSystemPromptModalOpen(true)}
            onKeyDown={(e) =>
              systemPrompt && (e.key === 'Enter' || e.key === ' ') && setSystemPromptModalOpen(true)
            }
            aria-label="点击查看完整系统提示词"
          >
            {systemPromptLoading ? (
              <div className="agent-right-loading">
                <Loader2 size={14} className="spinning" />
                <span>加载中</span>
              </div>
            ) : systemPrompt ? (
              <>
                <pre className="agent-context-text agent-system-prompt-preview">
                  {systemPrompt.length > 200 ? `${systemPrompt.slice(0, 200)}…` : systemPrompt}
                </pre>
                <span className="agent-context-click-hint">点击查看完整内容</span>
              </>
            ) : (
              <p className="agent-right-empty">暂无</p>
            )}
          </div>
          <button
            type="button"
            className="agent-right-refresh"
            onClick={loadSystemPrompt}
            disabled={systemPromptLoading}
          >
            刷新
          </button>
          <Modal
            open={systemPromptModalOpen}
            onCancel={() => setSystemPromptModalOpen(false)}
            title="系统提示词（发送前注入的完整前置提示词）"
            footer={null}
            width={640}
            styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
          >
            <pre className="agent-context-modal-text">{systemPrompt}</pre>
          </Modal>
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

        {/* Scope 交互：从工具调用解析的读/写/删等 */}
        <section className="agent-right-section agent-scope-interactions-section">
          <h3 className="agent-right-section-title">Scope 交互</h3>
          {!currentSession ? (
            <p className="agent-right-empty">选择会话后显示</p>
          ) : sessionContextLoading ? (
            <div className="agent-right-loading">
              <Loader2 size={14} className="spinning" />
              <span>加载中</span>
            </div>
          ) : !sessionContext?.scopeInteractions?.length ? (
            <p className="agent-right-empty">本会话暂无 scope 交互</p>
          ) : (
            <div className="agent-scope-interactions">
              {(['read', 'list', 'search', 'create', 'update', 'delete'] as const).map((action) => {
                const items = (sessionContext.scopeInteractions ?? []).filter(
                  (s) => s.action === action
                )
                if (items.length === 0) return null
                const Icon =
                  action === 'read' || action === 'list'
                    ? BookOpen
                    : action === 'search'
                    ? Search
                    : action === 'create'
                    ? PlusCircle
                    : action === 'update'
                    ? Pencil
                    : Trash2
                const label =
                  action === 'read'
                    ? '已读取'
                    : action === 'list'
                    ? '已列出'
                    : action === 'search'
                    ? '已搜索'
                    : action === 'create'
                    ? '已创建'
                    : action === 'update'
                    ? '已更新'
                    : '已删除'
                return (
                  <div key={action} className="agent-scope-interaction-group">
                    <span className="agent-scope-interaction-label">
                      <Icon size={12} />
                      {label}
                    </span>
                    <ul className="agent-scope-interaction-list">
                      {items.map((si, i) => (
                        <li
                          key={`${si.toolName}-${si.itemId ?? i}`}
                          className="agent-scope-interaction-item"
                        >
                          <span className="agent-scope-interaction-tool">
                            {getToolDisplayName(si.toolName)}
                          </span>
                          {si.itemKind && (
                            <span className="agent-scope-interaction-kind">[{si.itemKind}]</span>
                          )}
                          {si.itemId && (
                            <span className="agent-scope-interaction-id" title={si.itemId}>
                              {si.itemId.slice(0, 8)}
                            </span>
                          )}
                          {si.title && (
                            <span className="agent-scope-interaction-title" title={si.title}>
                              {si.title.length > 12 ? `${si.title.slice(0, 12)}…` : si.title}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
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
