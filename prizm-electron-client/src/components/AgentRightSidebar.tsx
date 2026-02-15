/**
 * Agent 右侧边栏 - 总览模式显示 scope 统计；会话模式显示状态、活动、记忆
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@lobehub/ui'
import { Select } from './ui/Select'
import { usePrizmContext } from '../context/PrizmContext'
import { MemoryInspector } from './agent/MemoryInspector'
import { TokenUsagePanel } from './agent/TokenUsagePanel'
import { useScope } from '../hooks/useScope'
import type {
  Document,
  AgentSession,
  AgentMessage,
  ToolCallRecord,
  AvailableModel
} from '@prizm/client-core'
import { getToolDisplayName } from '@prizm/client-core'

/** 会话级统计（与 @prizm/client-core SessionStats 对齐） */
interface SessionStats {
  sessionId: string
  scope: string
  tokenUsage: {
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    rounds: number
    byModel: Record<string, { input: number; output: number; total: number; count: number }>
  }
  memoryCreated: {
    totalCount: number
    byType: Record<string, number>
    memories: Array<{ id: string; memory: string; memory_type?: string; messageId: string }>
  }
}

/** 统一活动记录（与 API 返回一致） */
interface ActivityItem {
  toolName: string
  action: string
  itemKind?: string
  itemId?: string
  title?: string
  timestamp: number
}
import {
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wrench,
  MessageSquare,
  BookOpen,
  PlusCircle,
  Pencil,
  Trash2,
  Search,
  Brain,
  BarChart3,
  Layers,
  Activity,
  Coins,
  Sparkles
} from 'lucide-react'
import type { MemoryItem } from '@prizm/shared'

interface AgentRightSidebarProps {
  sending?: boolean
  error?: string | null
  currentSession?: AgentSession | null
  optimisticMessages?: AgentMessage[]
  selectedModel?: string
  onModelChange?: (model: string | undefined) => void
  overviewMode?: boolean
}

export function AgentRightSidebar({
  sending,
  error,
  currentSession,
  optimisticMessages = [],
  selectedModel,
  onModelChange,
  overviewMode
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
    activities: ActivityItem[]
  } | null>(null)
  const [sessionContextLoading, setSessionContextLoading] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false)
  const [threeLevelMemories, setThreeLevelMemories] = useState<{
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null>(null)
  const [threeLevelLoading, setThreeLevelLoading] = useState(false)
  const [sessionsCount, setSessionsCount] = useState(0)
  const [sessionsCountLoading, setSessionsCountLoading] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  const [sessionStatsLoading, setSessionStatsLoading] = useState(false)

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

  const loadThreeLevelMemories = useCallback(async () => {
    if (!http || !currentScope) return
    setThreeLevelLoading(true)
    try {
      const res = await http.getThreeLevelMemories(currentScope, currentSession?.id)
      if (res.enabled) {
        setThreeLevelMemories({ user: res.user, scope: res.scope, session: res.session })
      } else {
        setThreeLevelMemories(null)
      }
    } catch {
      setThreeLevelMemories(null)
    } finally {
      setThreeLevelLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  const loadSessionsCount = useCallback(async () => {
    if (!http || !currentScope) return
    setSessionsCountLoading(true)
    try {
      const list = await http.listAgentSessions(currentScope)
      setSessionsCount(list?.length ?? 0)
    } catch {
      setSessionsCount(0)
    } finally {
      setSessionsCountLoading(false)
    }
  }, [http, currentScope])

  const loadSessionContext = useCallback(async () => {
    if (!http || !currentScope || !currentSession?.id) return
    setSessionContextLoading(true)
    try {
      const ctx = await http.getAgentSessionContext(currentSession.id, currentScope)
      setSessionContext({
        provisions: ctx.provisions ?? [],
        activities: ctx.activities ?? []
      })
    } catch {
      setSessionContext(null)
    } finally {
      setSessionContextLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  const loadSessionStats = useCallback(async () => {
    if (!http || !currentScope || !currentSession?.id) return
    setSessionStatsLoading(true)
    try {
      const stats = await http.getAgentSessionStats(currentSession.id, currentScope)
      setSessionStats(stats)
    } catch {
      setSessionStats(null)
    } finally {
      setSessionStatsLoading(false)
    }
  }, [http, currentScope, currentSession?.id])

  // --- effects: initial loads ---
  useEffect(() => {
    void loadScopeContext()
    void loadDocuments()
    void loadSystemPrompt()
  }, [loadScopeContext, loadDocuments, loadSystemPrompt])

  useEffect(() => {
    if (currentSession?.id && currentScope) {
      void loadSessionContext()
      void loadSessionStats()
    } else {
      setSessionContext(null)
      setSessionStats(null)
    }
  }, [currentSession?.id, currentScope, loadSessionContext, loadSessionStats])

  useEffect(() => {
    if (currentScope) void loadThreeLevelMemories()
  }, [currentScope, currentSession?.id, loadThreeLevelMemories])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (overviewMode) void loadSessionsCount()
  }, [overviewMode, loadSessionsCount])

  // --- auto-refresh: when sending transitions true→false, reload session data ---
  const prevSendingRef = useRef(sending)
  useEffect(() => {
    if (prevSendingRef.current && !sending && currentSession?.id) {
      void loadSessionContext()
      void loadThreeLevelMemories()
      void loadSessionStats()
    }
    prevSendingRef.current = sending
  }, [sending, currentSession?.id, loadSessionContext, loadThreeLevelMemories, loadSessionStats])

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

  // --- provisions summary for compact display ---
  const provisionsSummary = useMemo(() => {
    const provisions = sessionContext?.provisions ?? []
    if (provisions.length === 0) return null
    const byKind: Record<string, number> = {}
    for (const p of provisions) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1
    }
    const parts = Object.entries(byKind).map(([k, n]) => `${k} x${n}`)
    return `引用了 ${provisions.length} 项 (${parts.join(', ')})`
  }, [sessionContext?.provisions])

  // --- format helpers ---
  const formatToken = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const MEMORY_TYPE_LABELS: Record<string, string> = {
    episodic_memory: '情景记忆',
    user_profile: '用户画像',
    foresight: '前瞻',
    event_log: '事件日志',
    document_memory: '文档记忆'
  }

  // --- activity action helpers ---
  const ACTION_CONFIG = {
    read: { icon: BookOpen, label: '读取' },
    list: { icon: BookOpen, label: '列出' },
    search: { icon: Search, label: '搜索' },
    create: { icon: PlusCircle, label: '创建' },
    update: { icon: Pencil, label: '更新' },
    delete: { icon: Trash2, label: '删除' }
  } as const

  const isNewConversationReady = !overviewMode && !currentSession

  return (
    <aside className="agent-right-sidebar">
      <div className="agent-right-sidebar-header">
        <span className="agent-right-sidebar-title">
          {overviewMode ? '工作区总览' : isNewConversationReady ? '新对话' : 'Agent 状态'}
        </span>
      </div>

      <div className="agent-right-sidebar-body">
        {overviewMode ? (
          <>
            {/* ====== 总览模式 ====== */}

            {/* Scope 统计概览 */}
            <section className="agent-right-section">
              <h3 className="agent-right-section-title">
                <BarChart3 size={14} className="agent-right-section-icon" />
                Scope 概览
              </h3>
              <div className="agent-overview-stats">
                <div className="agent-overview-stat-row">
                  <span className="agent-overview-stat-label">
                    <Layers size={12} /> 当前 Scope
                  </span>
                  <span className="agent-overview-stat-value">{currentScope || 'default'}</span>
                </div>
                <div className="agent-overview-stat-row">
                  <span className="agent-overview-stat-label">
                    <MessageSquare size={12} /> 会话数
                  </span>
                  <span className="agent-overview-stat-value">
                    {sessionsCountLoading ? '...' : sessionsCount}
                  </span>
                </div>
                <div className="agent-overview-stat-row">
                  <span className="agent-overview-stat-label">
                    <FileText size={12} /> 文档数
                  </span>
                  <span className="agent-overview-stat-value">
                    {documentsLoading ? '...' : documents.length}
                  </span>
                </div>
              </div>
            </section>

            {/* 模型 */}
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

            {/* 记忆状态 */}
            <section className="agent-right-section">
              <h3 className="agent-right-section-title">
                <Brain size={14} className="agent-right-section-icon" />
                记忆状态
              </h3>
              {threeLevelLoading ? (
                <div className="agent-right-loading">
                  <Loader2 size={14} className="spinning" />
                  <span>加载中</span>
                </div>
              ) : threeLevelMemories ? (
                <div className="agent-memory-state">
                  <div className="agent-memory-tier">
                    <span className="agent-memory-tier-label">User 层</span>
                    <span className="agent-memory-tier-count">
                      {threeLevelMemories.user.length}
                    </span>
                  </div>
                  <div className="agent-memory-tier">
                    <span className="agent-memory-tier-label">Scope 层</span>
                    <span className="agent-memory-tier-count">
                      {threeLevelMemories.scope.length}
                    </span>
                  </div>
                  <div className="agent-memory-tier">
                    <span className="agent-memory-tier-label">Session 层</span>
                    <span className="agent-memory-tier-count">
                      {threeLevelMemories.session.length}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="agent-right-empty">暂无记忆或未启用</p>
              )}
            </section>

            {/* 记忆库 */}
            <section className="agent-right-section">
              <h3 className="agent-right-section-title">记忆库</h3>
              <MemoryInspector />
            </section>

            {/* Token 使用 */}
            <section className="agent-right-section">
              <h3 className="agent-right-section-title">Token 使用</h3>
              <TokenUsagePanel />
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

            {/* 文档列表（简化：仅标题） */}
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
                  <ul className="agent-documents-ul agent-documents-compact">
                    {documents.map((doc) => (
                      <li key={doc.id} className="agent-document-item-compact">
                        <FileText size={12} className="agent-doc-icon" />
                        <span className="agent-document-title" title={doc.title}>
                          {doc.title || '未命名'}
                        </span>
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
          </>
        ) : (
          <>
            {/* ====== 会话/新对话模式 ====== */}

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
                ) : isNewConversationReady ? (
                  <>
                    <CheckCircle2 className="agent-status-icon idle" size={14} />
                    <span>就绪 - 新对话</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="agent-status-icon idle" size={14} />
                    <span>就绪</span>
                  </>
                )}
              </div>
            </section>

            {/* 系统提示词 - 仅会话模式显示 */}
            {!isNewConversationReady && (
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
                    systemPrompt &&
                    (e.key === 'Enter' || e.key === ' ') &&
                    setSystemPromptModalOpen(true)
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
                        {systemPrompt.length > 200
                          ? `${systemPrompt.slice(0, 200)}…`
                          : systemPrompt}
                      </pre>
                      <span className="agent-context-click-hint">点击查看完整内容</span>
                    </>
                  ) : (
                    <p className="agent-right-empty">暂无</p>
                  )}
                </div>
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
            )}

            {/* 会话活动 - 仅会话模式显示 */}
            {!isNewConversationReady && (
              <section className="agent-right-section">
                <h3 className="agent-right-section-title">
                  <Activity size={14} className="agent-right-section-icon" />
                  会话活动
                </h3>
                {!currentSession ? (
                  <p className="agent-right-empty">选择会话后显示</p>
                ) : sessionContextLoading && !sessionContext ? (
                  <div className="agent-right-loading">
                    <Loader2 size={14} className="spinning" />
                    <span>加载中</span>
                  </div>
                ) : (
                  <div className="agent-session-activity">
                    {/* 最近工具调用 */}
                    {latestToolCalls.length > 0 && (
                      <div className="agent-activity-group">
                        <span className="agent-activity-group-label">
                          <Wrench size={12} />
                          最近工具调用
                        </span>
                        <ul className="agent-activity-list">
                          {latestToolCalls.map((tc) => (
                            <li
                              key={tc.id}
                              className={`agent-activity-item${tc.isError ? ' error' : ''}`}
                              title={tc.result}
                            >
                              <span className="agent-activity-tool-name">
                                {getToolDisplayName(tc.name)}
                              </span>
                              {tc.isError && (
                                <span className="agent-activity-badge error">失败</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 引用项概要 */}
                    {provisionsSummary && (
                      <div className="agent-activity-group">
                        <span className="agent-activity-group-label">
                          <FileText size={12} />
                          上下文引用
                        </span>
                        <p className="agent-activity-summary">{provisionsSummary}</p>
                      </div>
                    )}

                    {/* 活动时间线 */}
                    {(sessionContext?.activities?.length ?? 0) > 0 && (
                      <div className="agent-activity-group">
                        <span className="agent-activity-group-label">
                          <BookOpen size={12} />
                          Scope 操作
                        </span>
                        <ul className="agent-activity-list">
                          {(['create', 'update', 'delete', 'read', 'list', 'search'] as const).map(
                            (action) => {
                              const items = (sessionContext?.activities ?? []).filter(
                                (s) => s.action === action
                              )
                              if (items.length === 0) return null
                              const cfg = ACTION_CONFIG[action]
                              const Icon = cfg.icon
                              return items.map((si, i) => (
                                <li
                                  key={`${action}-${si.itemId ?? i}`}
                                  className="agent-activity-item"
                                >
                                  <Icon size={11} className="agent-activity-action-icon" />
                                  <span className="agent-activity-action-label">{cfg.label}</span>
                                  {si.itemKind && (
                                    <span className="agent-activity-kind">{si.itemKind}</span>
                                  )}
                                  {si.title && (
                                    <span className="agent-activity-title" title={si.title}>
                                      {si.title.length > 16
                                        ? `${si.title.slice(0, 16)}…`
                                        : si.title}
                                    </span>
                                  )}
                                </li>
                              ))
                            }
                          )}
                        </ul>
                      </div>
                    )}

                    {/* 空状态 */}
                    {latestToolCalls.length === 0 &&
                      !provisionsSummary &&
                      (sessionContext?.activities?.length ?? 0) === 0 && (
                        <p className="agent-right-empty">本会话暂无活动</p>
                      )}
                  </div>
                )}
              </section>
            )}

            {/* 记忆状态（scope 级别，始终显示） */}
            <section className="agent-right-section">
              <h3 className="agent-right-section-title">
                <Brain size={14} className="agent-right-section-icon" />
                记忆状态
              </h3>
              {threeLevelLoading ? (
                <div className="agent-right-loading">
                  <Loader2 size={14} className="spinning" />
                  <span>加载中</span>
                </div>
              ) : threeLevelMemories ? (
                <div className="agent-memory-state">
                  <div className="agent-memory-tier">
                    <span className="agent-memory-tier-label">User 层</span>
                    <span className="agent-memory-tier-count">
                      {threeLevelMemories.user.length}
                    </span>
                  </div>
                  <div className="agent-memory-tier">
                    <span className="agent-memory-tier-label">Scope 层</span>
                    <span className="agent-memory-tier-count">
                      {threeLevelMemories.scope.length}
                    </span>
                  </div>
                  {!isNewConversationReady && (
                    <div className="agent-memory-tier">
                      <span className="agent-memory-tier-label">Session 层</span>
                      <span className="agent-memory-tier-count">
                        {threeLevelMemories.session.length}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="agent-right-empty">暂无记忆或未启用</p>
              )}
            </section>

            {/* 会话统计 - 仅会话模式显示 */}
            {!isNewConversationReady && (
              <section className="agent-right-section">
                <h3 className="agent-right-section-title">
                  <BarChart3 size={14} className="agent-right-section-icon" />
                  会话统计
                </h3>
                {!currentSession ? (
                  <p className="agent-right-empty">选择会话后显示</p>
                ) : sessionStatsLoading && !sessionStats ? (
                  <div className="agent-right-loading">
                    <Loader2 size={14} className="spinning" />
                    <span>加载中</span>
                  </div>
                ) : sessionStats ? (
                  <div className="agent-session-stats">
                    {/* Token 消耗 */}
                    <div className="agent-stats-group">
                      <span className="agent-stats-group-label">
                        <Coins size={12} />
                        Token 消耗
                      </span>
                      <div className="agent-stats-rows">
                        <div className="agent-stats-row">
                          <span className="agent-stats-key">合计</span>
                          <span className="agent-stats-value">
                            {formatToken(sessionStats.tokenUsage.totalTokens)}
                          </span>
                        </div>
                        <div className="agent-stats-row">
                          <span className="agent-stats-key">输入 / 输出</span>
                          <span className="agent-stats-value agent-stats-value-secondary">
                            {formatToken(sessionStats.tokenUsage.totalInputTokens)} /{' '}
                            {formatToken(sessionStats.tokenUsage.totalOutputTokens)}
                          </span>
                        </div>
                        <div className="agent-stats-row">
                          <span className="agent-stats-key">对话轮次</span>
                          <span className="agent-stats-value">
                            {sessionStats.tokenUsage.rounds}
                          </span>
                        </div>
                        {Object.keys(sessionStats.tokenUsage.byModel).length > 1 &&
                          Object.entries(sessionStats.tokenUsage.byModel).map(([model, info]) => (
                            <div key={model} className="agent-stats-row agent-stats-row-sub">
                              <span className="agent-stats-key" title={model}>
                                {model.length > 18 ? `${model.slice(0, 18)}…` : model}
                              </span>
                              <span className="agent-stats-value agent-stats-value-secondary">
                                {formatToken(info.total)} ({info.count}次)
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* 创建的记忆 */}
                    <div className="agent-stats-group">
                      <span className="agent-stats-group-label">
                        <Sparkles size={12} />
                        创建的记忆
                      </span>
                      {sessionStats.memoryCreated.totalCount === 0 ? (
                        <p className="agent-right-empty">本会话暂未产生记忆</p>
                      ) : (
                        <div className="agent-stats-rows">
                          <div className="agent-stats-row">
                            <span className="agent-stats-key">总数</span>
                            <span className="agent-stats-value">
                              {sessionStats.memoryCreated.totalCount} 条
                            </span>
                          </div>
                          {Object.entries(sessionStats.memoryCreated.byType).map(([type, cnt]) => (
                            <div key={type} className="agent-stats-row agent-stats-row-sub">
                              <span className="agent-stats-key">
                                {MEMORY_TYPE_LABELS[type] ?? type}
                              </span>
                              <span className="agent-stats-value agent-stats-value-secondary">
                                {cnt}
                              </span>
                            </div>
                          ))}
                          {sessionStats.memoryCreated.memories.length > 0 && (
                            <ul className="agent-stats-memory-list">
                              {sessionStats.memoryCreated.memories.map((mem) => (
                                <li
                                  key={mem.id}
                                  className="agent-stats-memory-item"
                                  title={mem.memory}
                                >
                                  <span className="agent-stats-memory-type">
                                    {MEMORY_TYPE_LABELS[mem.memory_type ?? ''] ??
                                      mem.memory_type ??
                                      ''}
                                  </span>
                                  <span className="agent-stats-memory-text">
                                    {mem.memory.length > 60
                                      ? `${mem.memory.slice(0, 60)}…`
                                      : mem.memory}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="agent-right-empty">暂无统计</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
