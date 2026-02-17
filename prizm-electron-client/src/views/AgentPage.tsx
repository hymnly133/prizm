/**
 * Agent 页面 - 会话列表 + 消息区（lobe-ui ChatList/ChatItem）+ 输入框
 * 参照 lobehub 对话逻辑，使用 lobe-ui 对话框组件，显示 token 等信息
 * 支持停止生成、错误提示、会话重命名
 * 输入框使用 @lobehub/editor ChatInput，悬浮面板样式
 */
import { ActionIcon, Empty, Flexbox, List, Markdown, Segmented, Tag } from '@lobehub/ui'
import { ChatActionsBar as BaseChatActionsBar, ChatList, type ChatMessage } from '@lobehub/ui/chat'

/** 过滤 createAt/updateAt 等非 DOM 属性，避免 React 警告 */
function ChatActionsBar(props: React.ComponentProps<typeof BaseChatActionsBar>) {
  const { createAt, updateAt, ...rest } = props as typeof props & {
    createAt?: unknown
    updateAt?: unknown
  }
  return <BaseChatActionsBar {...rest} />
}
import {
  FolderTree,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Trash2,
  X,
  Terminal as TerminalLucide
} from 'lucide-react'
import { FileTreePanel } from '../components/agent/FileTreePanel'
import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { WorkNavigationContext } from '../context/WorkNavigationContext'
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useScope } from '../hooks/useScope'
import { usePendingInteractSessionIds } from '../events/agentBackgroundStore'
import type { FileKind } from '../hooks/useFileList'
import { MessageUsage } from '../components/MessageUsage'
import { AgentRightSidebar } from '../components/AgentRightSidebar'
import { ResizableSidebar } from '../components/layout'
import {
  ChatInputProvider,
  DesktopChatInput,
  PendingChatPayloadApplicator,
  useChatInputStore,
  useChatInputStoreApi,
  type ActionKeys
} from '../features/ChatInput'
import type { AgentMessage, MessagePart, MessagePartTool } from '@prizm/client-core'
import type { Document as PrizmDocument, TodoList } from '@prizm/client-core'
import {
  ToolCallCard,
  MemoryRefsTag,
  GrantPathProvider,
  InteractProvider
} from '../components/agent'
import type { GrantPathContextValue, InteractContextValue } from '../components/agent'
import { AgentOverviewPanel } from '../components/agent/AgentOverviewPanel'
import { TerminalSidebarTab } from '../components/agent/TerminalSidebarTab'
// 注册终端工具卡片渲染器（副作用导入）
import '../components/agent/TerminalToolCards'

/* ── 文件内嵌预览面板 ── */
const KIND_LABELS: Record<FileKind, string> = {
  note: '便签',
  document: '文档',
  todoList: '待办列表'
}

function FilePreviewPanel({
  fileRef,
  scope,
  onClose
}: {
  fileRef: { kind: FileKind; id: string }
  scope: string
  onClose: () => void
}) {
  const { manager } = usePrizmContext()
  const http = manager?.getHttpClient()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (!http) return
    setLoading(true)
    setError(null)

    const fetchFile = async () => {
      try {
        if (fileRef.kind === 'document' || fileRef.kind === 'note') {
          const doc = await http.getDocument(fileRef.id, scope)
          const titleStr = (doc as PrizmDocument).title
          const contentStr = (doc as PrizmDocument).content ?? ''
          setTitle(
            fileRef.kind === 'note'
              ? contentStr.split('\n')[0]?.trim() || '便签'
              : titleStr || '无标题文档'
          )
          setContent(contentStr)
        } else if (fileRef.kind === 'todoList') {
          const list = await http.getTodoList(scope, fileRef.id)
          if (list) {
            setTitle((list as TodoList).title || '待办列表')
            const items = (list as TodoList).items ?? []
            const md = items
              .map((it) => `- [${it.status === 'done' ? 'x' : ' '}] ${it.title}`)
              .join('\n')
            setContent(md || '(空列表)')
          } else {
            setError('未找到该待办列表')
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    void fetchFile()
  }, [http, fileRef.kind, fileRef.id, scope])

  return (
    <div className="file-preview-panel">
      <div className="file-preview-panel__header">
        <Flexbox horizontal align="center" gap={8} flex={1} style={{ minWidth: 0 }}>
          <Tag size="small">{KIND_LABELS[fileRef.kind]}</Tag>
          <span className="file-preview-panel__title">{title || '加载中…'}</span>
        </Flexbox>
        <ActionIcon icon={X} size="small" title="关闭" onClick={onClose} />
      </div>
      <div className="file-preview-panel__body">
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>加载中…</div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            {error}
          </div>
        ) : (
          <div className="md-preview-wrap">
            <Markdown>{content || '(空)'}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
}

/** Draft cache key for new (unsaved) conversations */
const DRAFT_KEY_NEW = '__new__'
/** Module-level draft cache: sessionId → markdown content, survives session switches & page toggles */
const _draftCache = new Map<string, string>()

/**
 * When PendingChatPayloadApplicator sets content during a forceNew flow,
 * DraftCacheManager must NOT overwrite it when the session switches.
 * This flag is set in the pendingPayload handler and consumed by DraftCacheManager.
 */
let _skipNextDraftRestore = false

/**
 * Saves / restores draft per session (keyed by sessionId).
 * - On mount (or sessionId change): restores cached content
 * - On cleanup (unmount or before sessionId change): saves current content
 * Must be a child of ChatInputProvider.
 */
function DraftCacheManager({ sessionId }: { sessionId: string }) {
  const storeApi = useChatInputStoreApi()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)

  useEffect(() => {
    if (_skipNextDraftRestore) {
      _skipNextDraftRestore = false
      return () => {
        const content = storeApi.getState().markdownContent
        if (content.trim()) {
          _draftCache.set(sessionId, content)
        } else {
          _draftCache.delete(sessionId)
        }
      }
    }

    const cached = _draftCache.get(sessionId) ?? ''
    setMarkdownContent(cached)

    return () => {
      const content = storeApi.getState().markdownContent
      if (content.trim()) {
        _draftCache.set(sessionId, content)
      } else {
        _draftCache.delete(sessionId)
      }
    }
  }, [sessionId, storeApi, setMarkdownContent])

  return null
}

/** 从消息得到按顺序的段落：有 parts 用 parts，否则用 content + toolCalls 推导（一段文本 + 工具在末尾） */
function getMessageParts(m: AgentMessage): MessagePart[] {
  if (Array.isArray(m.parts) && m.parts.length > 0) return m.parts
  const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : []
  const list: MessagePart[] = []
  if (m.content?.trim()) list.push({ type: 'text', content: m.content })
  for (const tc of toolCalls) {
    if (tc && typeof tc === 'object' && 'id' in tc && 'name' in tc) {
      const t = tc as {
        id: string
        name: string
        arguments?: string
        result?: string
        isError?: boolean
        status?: 'preparing' | 'running' | 'done'
      }
      list.push({
        type: 'tool',
        id: t.id,
        name: t.name,
        arguments: t.arguments ?? '',
        result: t.result ?? '',
        ...(t.isError && { isError: true }),
        ...(t.status && { status: t.status })
      })
    }
  }
  return list
}

/** 将 AgentMessage 转为 lobe-ui ChatMessage 格式 */
function toChatMessage(m: AgentMessage & { streaming?: boolean }): ChatMessage {
  const ts = m.createdAt
  const title = m.role === 'user' ? '你' : m.role === 'system' ? '命令结果' : 'AI'
  const avatar = m.role === 'user' ? '👤' : m.role === 'system' ? '⚡' : '🤖'
  return {
    id: m.id,
    content: m.content,
    role: m.role,
    createAt: ts,
    updateAt: ts,
    meta: {
      title,
      avatar
    },
    extra: {
      model: m.model,
      usage: m.usage,
      streaming: m.streaming,
      reasoning: m.reasoning,
      toolCalls: m.toolCalls,
      parts: getMessageParts(m),
      memoryRefs: m.memoryRefs,
      messageId: m.id
    }
  }
}

/** 助手消息额外信息：思考过程 + MessageUsage + 记忆标签；工具已内联时不再底部汇总 */
function AssistantMessageExtra(props: ChatMessage) {
  const { manager } = usePrizmContext() ?? {}
  const { currentScope } = useScope()
  const extra = props.extra as
    | {
        model?: string
        usage?: { totalTokens?: number; totalInputTokens?: number; totalOutputTokens?: number }
        reasoning?: string
        toolCalls?: Array<MessagePartTool & { id: string }>
        parts?: MessagePart[]
        memoryRefs?: import('@prizm/shared').MemoryRefs | null
        messageId?: string
      }
    | undefined
  const hasReasoning = !!extra?.reasoning?.trim()
  const parts = extra?.parts
  const hasInlineTools = Array.isArray(parts) && parts.some((p) => p.type === 'tool')
  const toolCalls = Array.isArray(extra?.toolCalls) ? extra.toolCalls : []
  const hasToolCalls = !hasInlineTools && toolCalls.length > 0
  const http = manager?.getHttpClient()

  const handleResolve = useCallback(
    async (byLayer: import('@prizm/shared').MemoryIdsByLayer) => {
      if (!http) return {}
      return http.resolveMemoryIds(byLayer, currentScope)
    },
    [http, currentScope]
  )

  return (
    <div className="assistant-message-extra">
      {hasReasoning && (
        <details className="reasoning-details">
          <summary className="reasoning-summary">思考过程</summary>
          <pre className="reasoning-content">{extra!.reasoning}</pre>
        </details>
      )}
      {hasToolCalls && (
        <details className="tool-calls-details">
          <summary className="tool-calls-summary">工具调用 ({toolCalls.length})</summary>
          <ul className="tool-calls-list">
            {toolCalls.map((tc) => (
              <li key={tc.id} className={`tool-call-item ${tc.isError ? 'error' : ''}`}>
                <ToolCallCard tc={tc} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <Flexbox horizontal align="center" gap={4} wrap="wrap">
        <MessageUsage model={extra?.model} usage={extra?.usage} />
        <MemoryRefsTag
          memoryRefs={extra?.memoryRefs}
          onResolve={handleResolve}
          scope={currentScope}
        />
      </Flexbox>
    </div>
  )
}

function AgentPage() {
  const { currentScope } = useScope()
  const { manager } = usePrizmContext()
  const { pendingPayload } = useChatWithFile()
  const { scopeItems, slashCommands } = useAgentScopeData(currentScope)
  const {
    sessions,
    currentSession,
    loading,
    sending,
    thinking,
    error,
    createSession,
    deleteSession,
    loadSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    optimisticMessages,
    selectedModel,
    setSelectedModel,
    pendingInteract,
    respondToInteract
  } = useAgent(currentScope)

  const pendingInteractSessionIds = usePendingInteractSessionIds()
  const [overviewMode, setOverviewMode] = useState(!currentSession)
  const [previewFile, setPreviewFile] = useState<{ kind: FileKind; id: string } | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'context' | 'files' | 'terminal'>('context')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pendingHandledRef = useRef<string | null>(null)

  /** Sync draft content to module-level cache for cross-page / cross-session persistence */
  const handleMarkdownContentChange = useCallback(
    (content: string) => {
      const key = currentSession?.id ?? DRAFT_KEY_NEW
      if (content.trim()) {
        _draftCache.set(key, content)
      } else {
        _draftCache.delete(key)
      }
    },
    [currentSession]
  )

  useEffect(() => {
    if (!pendingPayload) return
    // 不因 loading 阻塞：有 pendingPayload 时应立即切换至输入视图并应用内容
    const filesKey = pendingPayload.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
    const fileRefsKey = pendingPayload.fileRefs?.map((f) => f.path).join(',') ?? ''
    const key = `${filesKey}|${fileRefsKey}|${pendingPayload.text ?? ''}|${
      pendingPayload.sessionId ?? 'new'
    }|${pendingPayload.forceNew ? 'force' : ''}`
    console.log('[ImportAI-Chip] AgentPage pendingPayload 效果', {
      hasPendingPayload: true,
      fileRefsCount: pendingPayload.fileRefs?.length ?? 0,
      fileRefs: pendingPayload.fileRefs,
      filesCount: pendingPayload.files?.length ?? 0,
      skipDueToDedup: pendingHandledRef.current === key,
      key
    })
    if (pendingHandledRef.current === key) return
    pendingHandledRef.current = key
    setOverviewMode(false)
    if (pendingPayload.forceNew) {
      _skipNextDraftRestore = true
      setCurrentSession(null)
    } else if (pendingPayload.sessionId) {
      loadSession(pendingPayload.sessionId)
    }
    console.log('[ImportAI-Chip] AgentPage 已 setOverviewMode(false)，ChatInputProvider 将挂载')
    // No need to create session here - lazy creation on send handles it
  }, [pendingPayload, loadSession, setCurrentSession])

  useEffect(() => {
    if (!pendingPayload) pendingHandledRef.current = null
  }, [pendingPayload])

  const handleSend = useCallback(
    async ({
      clearContent,
      getMarkdownContent,
      getInputRefs
    }: {
      clearContent: () => void
      getMarkdownContent: () => string
      getInputRefs: () => import('../features/ChatInput/store/initialState').InputRef[]
    }) => {
      const rawText = getMarkdownContent().trim()
      const refs = getInputRefs()
      if (!rawText && refs.length === 0) return
      if (sending) return

      let session = currentSession
      if (!session || overviewMode) {
        setOverviewMode(false)
        session = await createSession()
        if (!session) return
      }

      // Combine: prepend ref markdown tags before user text
      const refParts = refs.map((r) => r.markdown)
      const combined = [...refParts, rawText].filter(Boolean).join('\n')

      // Derive FilePathRef[] for file-type refs (server needs these for grantedPaths)
      const fileRefs: import('@prizm/shared').FilePathRef[] = refs
        .filter((r) => r.type === 'file')
        .map((r) => ({
          path: r.key.replace(/%29/g, ')'),
          name: r.label
        }))

      _draftCache.delete(DRAFT_KEY_NEW)
      if (session) _draftCache.delete(session.id)
      clearContent()
      await sendMessage(combined, session, fileRefs.length > 0 ? fileRefs : undefined)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
    [currentSession, sending, createSession, sendMessage, overviewMode]
  )

  /** 清空：切换到新对话准备态（不创建服务端会话） */
  const handleClear = useCallback(() => {
    setOverviewMode(false)
    setCurrentSession(null)
  }, [setCurrentSession])

  const leftActions: ActionKeys[] = ['fileUpload', 'clear']

  /** 单一消息源：服务器消息 + 乐观更新（流式过程中原地更新 assistant） */
  const chatData: ChatMessage[] = useMemo(() => {
    if (!currentSession) return []

    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...currentSession.messages,
      ...optimisticMessages.map((m) => ({
        ...m,
        streaming: sending && m.role === 'assistant' && m.id.startsWith('assistant-')
      }))
    ]

    // 按 ID 去重：同一 ID 出现多次时保留后者（乐观/流式版本优先）
    const lastIdx = new Map<string, number>()
    messages.forEach((m, i) => lastIdx.set(m.id, i))
    const deduped = messages.filter((m, i) => lastIdx.get(m.id) === i)

    return deduped.map(toChatMessage)
  }, [currentSession, optimisticMessages, sending])

  // 显示 loading 的场景：
  // 1. 流式进行中但还没有任何内容（初始等待阶段）
  // 2. thinking=true：收到心跳但无可见事件（LLM 在生成长工具参数）
  const lastMsg = chatData[chatData.length - 1]
  const lastExtra = lastMsg?.extra as { parts?: MessagePart[] } | undefined
  const lastMsgHasContent =
    !!lastMsg?.content?.trim?.() || (Array.isArray(lastExtra?.parts) && lastExtra!.parts.length > 0)
  const loadingId =
    sending && chatData.length > 0 && (!lastMsgHasContent || thinking)
      ? chatData[chatData.length - 1].id
      : undefined

  const grantPathValue = useMemo<GrantPathContextValue>(
    () => ({
      grantPaths: async (paths: string[]) => {
        const httpClient = manager?.getHttpClient()
        if (!httpClient || !currentSession) return
        await httpClient.grantSessionPaths(currentSession.id, paths, currentScope)
      }
    }),
    [manager, currentSession, currentScope]
  )

  const interactValue = useMemo<InteractContextValue>(
    () => ({
      pendingInteract,
      respondToInteract
    }),
    [pendingInteract, respondToInteract]
  )

  const sessionListItems = sessions.map((s) => {
    const needsInteract = pendingInteractSessionIds.has(s.id)
    return {
      key: s.id,
      classNames: { actions: 'agent-session-actions' },
      title: (
        <div className="agent-session-item">
          <span className="agent-session-item-summary" title={s.llmSummary}>
            {needsInteract && <span className="agent-session-interact-badge" title="需要确认" />}
            {s.llmSummary?.trim() || '新会话'}
          </span>
        </div>
      ),
      actions: (
        <ActionIcon
          icon={Trash2}
          title="删除"
          size="small"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            deleteSession(s.id)
          }}
        />
      ),
      showAction: true,
      onClick: () => {
        setOverviewMode(false)
        loadSession(s.id)
      }
    }
  })

  return (
    <GrantPathProvider value={grantPathValue}>
      <InteractProvider value={interactValue}>
        <section className="agent-page">
          <ResizableSidebar side="left" storageKey="agent-sessions" defaultWidth={220}>
            <div className="agent-sidebar">
              <div className="agent-sidebar-header">
                <span className="agent-sidebar-title">会话</span>
                <ActionIcon
                  icon={Plus}
                  title="新建会话"
                  onClick={() => {
                    setOverviewMode(false)
                    setCurrentSession(null)
                  }}
                  disabled={loading}
                />
              </div>
              <div className="agent-sessions-list">
                <div
                  className={`agent-overview-tab${overviewMode ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setOverviewMode(true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setOverviewMode(true)
                  }}
                >
                  <LayoutDashboard size={14} />
                  <span>总览</span>
                </div>
                {loading && sessions.length === 0 ? (
                  <div className="agent-sessions-loading">加载中...</div>
                ) : sessions.length === 0 ? (
                  <Empty title="暂无会话" description="点击 + 新建会话" />
                ) : (
                  <List
                    activeKey={overviewMode ? undefined : currentSession?.id}
                    items={sessionListItems}
                  />
                )}
              </div>
            </div>
          </ResizableSidebar>

          <WorkNavigationContext.Provider
            value={{
              openFileAtWork: (kind: FileKind, id: string) => setPreviewFile({ kind, id }),
              pendingWorkFile: null,
              consumePendingWorkFile: () => {}
            }}
          >
            <div className="agent-content">
              {overviewMode ? (
                <div className="agent-main">
                  <AgentOverviewPanel
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                  />
                </div>
              ) : (
                <>
                  <div className="agent-main">
                    {currentSession ? (
                      <div className="agent-messages">
                        <ChatList
                          data={chatData}
                          variant="bubble"
                          showAvatar
                          showTitle
                          loadingId={loadingId}
                          renderActions={{
                            default: ChatActionsBar
                          }}
                          renderMessages={{
                            default: ({ editableContent }) => editableContent,
                            assistant: (props) => {
                              const extra = props.extra as { parts?: MessagePart[] } | undefined
                              const parts = extra?.parts
                              if (Array.isArray(parts) && parts.length > 0) {
                                return (
                                  <div className="assistant-message-by-parts">
                                    {parts.map((p, i) =>
                                      p.type === 'text' ? (
                                        <div key={i} className="assistant-part-text">
                                          <Markdown>{p.content}</Markdown>
                                        </div>
                                      ) : (
                                        <ToolCallCard
                                          key={p.id}
                                          tc={{
                                            id: p.id,
                                            name: p.name,
                                            arguments: p.arguments,
                                            result: p.result,
                                            isError: p.isError,
                                            status: (p as MessagePartTool).status
                                          }}
                                        />
                                      )
                                    )}
                                  </div>
                                )
                              }
                              return (
                                (props as { editableContent?: React.ReactNode }).editableContent ??
                                null
                              )
                            }
                          }}
                          renderMessagesExtra={{
                            assistant: AssistantMessageExtra
                          }}
                        />
                        {pendingInteract && sending && (
                          <div
                            className="agent-thinking-indicator"
                            style={{ color: 'var(--ant-color-warning)' }}
                          >
                            <span
                              className="agent-thinking-dot"
                              style={{ background: 'var(--ant-color-warning)' }}
                            />
                            AI 正在等待您的确认…
                          </div>
                        )}
                        {thinking && sending && !pendingInteract && (
                          <div className="agent-thinking-indicator">
                            <span className="agent-thinking-dot" />
                            AI 正在生成工具参数…
                          </div>
                        )}
                        <div ref={messagesEndRef} />
                      </div>
                    ) : (
                      <div className="agent-empty">
                        <Empty
                          title="新对话"
                          description={loading ? '加载中...' : '在下方输入开始对话，会话将自动创建'}
                        />
                      </div>
                    )}
                  </div>

                  {error && <div className="agent-error-banner">{error}</div>}

                  <div className="agent-input-wrap agent-input-floating">
                    <ChatInputProvider
                      leftActions={leftActions}
                      rightActions={[]}
                      scopeItems={scopeItems}
                      scopeSlashCommands={slashCommands}
                      sendButtonProps={{
                        disabled: sending,
                        generating: sending,
                        onStop: () => {
                          stopGeneration()
                        },
                        shape: 'round'
                      }}
                      onSend={handleSend}
                      onMarkdownContentChange={handleMarkdownContentChange}
                      allowExpand
                    >
                      <DraftCacheManager sessionId={currentSession?.id ?? DRAFT_KEY_NEW} />
                      <PendingChatPayloadApplicator />
                      <DesktopChatInput
                        onClear={handleClear}
                        inputContainerProps={{
                          minHeight: 88,
                          style: {
                            borderRadius: 20,
                            boxShadow: '0 12px 32px rgba(0,0,0,.04)'
                          }
                        }}
                      />
                    </ChatInputProvider>
                  </div>
                </>
              )}
            </div>

            {!overviewMode && (
              <ResizableSidebar
                side="right"
                storageKey="agent-right"
                defaultWidth={previewFile ? 360 : 280}
              >
                {previewFile ? (
                  <FilePreviewPanel
                    fileRef={previewFile}
                    scope={currentScope}
                    onClose={() => setPreviewFile(null)}
                  />
                ) : (
                  <Flexbox style={{ height: '100%', overflow: 'hidden' }} gap={0}>
                    <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
                      <Segmented
                        block
                        size="small"
                        value={sidebarTab}
                        onChange={(v) => setSidebarTab(v as 'context' | 'files' | 'terminal')}
                        options={[
                          { label: '上下文', value: 'context', icon: <MessageSquare size={12} /> },
                          { label: '文件', value: 'files', icon: <FolderTree size={12} /> },
                          { label: '终端', value: 'terminal', icon: <TerminalLucide size={12} /> }
                        ]}
                      />
                    </div>
                    {sidebarTab === 'context' ? (
                      <AgentRightSidebar
                        sending={sending}
                        error={error}
                        currentSession={currentSession}
                        optimisticMessages={optimisticMessages}
                        selectedModel={selectedModel}
                        onModelChange={setSelectedModel}
                        overviewMode={false}
                      />
                    ) : sidebarTab === 'files' ? (
                      <FileTreePanel
                        scope={currentScope}
                        sessionId={currentSession?.id}
                        onPreviewFile={(relativePath) => {
                          setPreviewFile({ kind: 'document', id: relativePath })
                        }}
                      />
                    ) : (
                      <TerminalSidebarTab sessionId={currentSession?.id} scope={currentScope} />
                    )}
                  </Flexbox>
                )}
              </ResizableSidebar>
            )}
          </WorkNavigationContext.Provider>
        </section>
      </InteractProvider>
    </GrantPathProvider>
  )
}

export default memo(AgentPage)
