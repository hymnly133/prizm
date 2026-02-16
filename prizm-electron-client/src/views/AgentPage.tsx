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
import { ToolCallCard, MemoryGrowthTag } from '../components/agent'
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
 * Saves / restores draft per session (keyed by sessionId).
 * - On mount (or sessionId change): restores cached content
 * - On cleanup (unmount or before sessionId change): saves current content
 * Must be a child of ChatInputProvider.
 */
function DraftCacheManager({ sessionId }: { sessionId: string }) {
  const storeApi = useChatInputStoreApi()
  const setMarkdownContent = useChatInputStore((s) => s.setMarkdownContent)

  useEffect(() => {
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
      memoryGrowth: m.memoryGrowth,
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
        memoryGrowth?: import('@prizm/shared').RoundMemoryGrowth | null
        messageId?: string
      }
    | undefined
  const hasReasoning = !!extra?.reasoning?.trim()
  const parts = extra?.parts
  const hasInlineTools = Array.isArray(parts) && parts.some((p) => p.type === 'tool')
  const toolCalls = Array.isArray(extra?.toolCalls) ? extra.toolCalls : []
  const hasToolCalls = !hasInlineTools && toolCalls.length > 0
  const http = manager?.getHttpClient()

  const handleFetchRoundMemories = useCallback(
    async (messageId: string) => {
      if (!http) return null
      return http.getRoundMemories(messageId, currentScope)
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
        {extra?.messageId && (
          <MemoryGrowthTag
            messageId={extra.messageId}
            memoryGrowth={extra.memoryGrowth}
            onFetch={handleFetchRoundMemories}
            scope={currentScope}
          />
        )}
      </Flexbox>
    </div>
  )
}

function AgentPage() {
  const { currentScope } = useScope()
  const { pendingPayload } = useChatWithFile()
  const { scopeItems, slashCommands } = useAgentScopeData(currentScope)
  const {
    sessions,
    currentSession,
    loading,
    sending,
    error,
    createSession,
    deleteSession,
    loadSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    optimisticMessages,
    selectedModel,
    setSelectedModel
  } = useAgent(currentScope)

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
    if (!pendingPayload || loading) return
    const filesKey = pendingPayload.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
    const key = `${filesKey}|${pendingPayload.text ?? ''}|${pendingPayload.sessionId ?? 'new'}`
    if (pendingHandledRef.current === key) return
    pendingHandledRef.current = key
    setOverviewMode(false)
    if (pendingPayload.sessionId) {
      loadSession(pendingPayload.sessionId)
    }
    // No need to create session here - lazy creation on send handles it
  }, [pendingPayload, loading, loadSession])

  useEffect(() => {
    if (!pendingPayload) pendingHandledRef.current = null
  }, [pendingPayload])

  const handleSend = useCallback(
    async ({
      clearContent,
      getMarkdownContent
    }: {
      clearContent: () => void
      getMarkdownContent: () => string
    }) => {
      const content = getMarkdownContent().trim()
      if (!content || sending) return

      let session = currentSession
      if (!session || overviewMode) {
        setOverviewMode(false)
        session = await createSession()
        if (!session) return
      }

      _draftCache.delete(DRAFT_KEY_NEW)
      if (session) _draftCache.delete(session.id)
      clearContent()
      await sendMessage(content, session)
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

    return messages.map(toChatMessage)
  }, [currentSession, optimisticMessages, sending])

  // 仅在没有流式内容时显示 loading，避免转圈遮挡正在输出的文字或工具卡片
  const lastMsg = chatData[chatData.length - 1]
  const lastExtra = lastMsg?.extra as { parts?: MessagePart[] } | undefined
  const lastMsgHasContent =
    !!lastMsg?.content?.trim?.() || (Array.isArray(lastExtra?.parts) && lastExtra!.parts.length > 0)
  const loadingId =
    sending && chatData.length > 0 && !lastMsgHasContent
      ? chatData[chatData.length - 1].id
      : undefined

  const sessionListItems = sessions.map((s) => ({
    key: s.id,
    classNames: { actions: 'agent-session-actions' },
    title: (
      <div className="agent-session-item">
        <span className="agent-session-item-summary" title={s.llmSummary}>
          {s.llmSummary?.trim() || '新会话'}
        </span>
      </div>
    ),
    actions: (
      <ActionIcon
        icon={Trash2}
        title="删除"
        size="small"
        onClick={(e) => {
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
  }))

  return (
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
              <AgentOverviewPanel selectedModel={selectedModel} onModelChange={setSelectedModel} />
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
                            (props as { editableContent?: React.ReactNode }).editableContent ?? null
                          )
                        }
                      }}
                      renderMessagesExtra={{
                        assistant: AssistantMessageExtra
                      }}
                    />
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
  )
}

export default memo(AgentPage)
