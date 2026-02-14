/**
 * Agent 页面 - 会话列表 + 消息区（lobe-ui ChatList/ChatItem）+ 输入框
 * 参照 lobehub 对话逻辑，使用 lobe-ui 对话框组件，显示 token 等信息
 * 支持停止生成、错误提示、会话重命名
 * 输入框使用 @lobehub/editor ChatInput，悬浮面板样式
 */
import { ActionIcon, Button, Empty, Flexbox, List, Markdown } from '@lobehub/ui'
import { ChatActionsBar as BaseChatActionsBar, ChatList, type ChatMessage } from '@lobehub/ui/chat'

/** 过滤 createAt/updateAt 等非 DOM 属性，避免 React 警告 */
function ChatActionsBar(props: React.ComponentProps<typeof BaseChatActionsBar>) {
  const { createAt, updateAt, ...rest } = props as typeof props & {
    createAt?: unknown
    updateAt?: unknown
  }
  return <BaseChatActionsBar {...rest} />
}
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, useMemo, useCallback } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useScope } from '../hooks/useScope'
import { MessageUsage } from '../components/MessageUsage'
import { AgentRightSidebar } from '../components/AgentRightSidebar'
import { ResizableSidebar } from '../components/layout'
import { ChatInputProvider, DesktopChatInput, type ActionKeys } from '../features/ChatInput'
import type { AgentMessage, MessagePart, MessagePartTool } from '@prizm/client-core'
import { ToolCallCard, MemoryGrowthTag } from '../components/agent'

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

export default function AgentPage() {
  const { currentScope } = useScope()
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
    updateSession,
    sendMessage,
    stopGeneration,
    optimisticMessages,
    selectedModel,
    setSelectedModel
  } = useAgent(currentScope)

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      if (!session) {
        session = await createSession()
        if (!session) return
      }

      clearContent() // 发送时立即清空输入框
      await sendMessage(content, session)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
    [currentSession, sending, createSession, sendMessage]
  )

  /** 清空：创建新会话 */
  const handleClear = useCallback(async () => {
    await createSession()
  }, [createSession])

  const leftActions: ActionKeys[] = ['fileUpload', 'clear']

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingSessionId(null)
      return
    }
    await updateSession(id, { title: editTitle.trim() })
    setEditingSessionId(null)
    setEditTitle('')
  }

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

  // 仅在没有流式内容时显示 loading，避免转圈遮挡正在输出的文字
  const lastMsg = chatData[chatData.length - 1]
  const lastMsgHasContent = !!lastMsg?.content?.trim?.()
  const loadingId =
    sending && chatData.length > 0 && !lastMsgHasContent
      ? chatData[chatData.length - 1].id
      : undefined

  const sessionListItems = sessions.map((s) => ({
    key: s.id,
    title:
      editingSessionId === s.id ? (
        <input
          className="agent-rename-input"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={() => handleRename(s.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename(s.id)
            if (e.key === 'Escape') setEditingSessionId(null)
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        s.title || '新会话'
      ),
    active: currentSession?.id === s.id,
    actions: (
      <>
        <ActionIcon
          icon={Pencil}
          title="重命名"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            setEditingSessionId(s.id)
            setEditTitle(s.title || '')
          }}
        />
        <ActionIcon
          icon={Trash2}
          title="删除"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            deleteSession(s.id)
          }}
        />
      </>
    ),
    showAction: currentSession?.id === s.id,
    onClick: () => loadSession(s.id)
  }))

  return (
    <section className="agent-page">
      <ResizableSidebar side="left" storageKey="agent-sessions" defaultWidth={220}>
        <div className="agent-sidebar">
          <div className="agent-sidebar-header">
            <span className="agent-sidebar-title">会话</span>
            <ActionIcon icon={Plus} title="新建会话" onClick={createSession} disabled={loading} />
          </div>
          <div className="agent-sessions-list">
            {loading && sessions.length === 0 ? (
              <div className="agent-sessions-loading">加载中...</div>
            ) : sessions.length === 0 ? (
              <Empty title="暂无会话" description="点击 + 新建会话" />
            ) : (
              <List activeKey={currentSession?.id} items={sessionListItems} />
            )}
          </div>
        </div>
      </ResizableSidebar>

      <div className="agent-content">
        <div className="agent-main">
          {currentSession ? (
            <>
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

              {error && <div className="agent-error-banner">{error}</div>}

              <p className="agent-input-hint">
                输入 <code>@</code> 引用便签/文档/待办（如 @note:id），输入 <code>/</code>{' '}
                执行命令（如 /notes、/todos、/help）
              </p>
              <div className="agent-input-wrap agent-input-floating">
                <ChatInputProvider
                  leftActions={leftActions}
                  rightActions={[]}
                  scopeItems={scopeItems}
                  scopeSlashCommands={slashCommands}
                  sendButtonProps={{
                    disabled: sending,
                    generating: sending,
                    onStop: ({ editor }) => {
                      stopGeneration()
                    },
                    shape: 'round'
                  }}
                  onSend={handleSend}
                  allowExpand
                >
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
          ) : (
            <div className="agent-empty">
              <Empty
                title="选择或创建会话"
                description={loading ? '加载中...' : '点击左侧 + 新建会话开始对话'}
                action={
                  !loading && sessions.length === 0 ? (
                    <Button type="primary" onClick={createSession}>
                      新建会话
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
      </div>

      <ResizableSidebar side="right" storageKey="agent-right" defaultWidth={280}>
        <AgentRightSidebar
          sending={sending}
          error={error}
          currentSession={currentSession}
          optimisticMessages={optimisticMessages}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
        />
      </ResizableSidebar>
    </section>
  )
}
