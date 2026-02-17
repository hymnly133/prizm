/**
 * Agent 页面 - 现代化 UI 重构
 * 三栏布局：会话列表 + 消息区(ChatList) + 智能右侧栏
 * 使用 motion 动画、LobeUI 组件、CSS-in-JS 主题
 */
import { ActionIcon, Empty, Flexbox, List, Markdown, Segmented } from '@lobehub/ui'
import { ChatActionsBar as BaseChatActionsBar, ChatList, type ChatMessage } from '@lobehub/ui/chat'
import { motion, AnimatePresence } from 'motion/react'

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
  Terminal as TerminalLucide,
  Brain
} from 'lucide-react'
import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react'
import { usePrizmContext } from '../context/PrizmContext'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { WorkNavigationContext } from '../context/WorkNavigationContext'
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useScope } from '../hooks/useScope'
import { usePendingInteractSessionIds } from '../events/agentBackgroundStore'
import type { FileKind } from '../hooks/useFileList'
import { AgentRightSidebar } from '../components/AgentRightSidebar'
import { ResizableSidebar } from '../components/layout'
import {
  ChatInputProvider,
  DesktopChatInput,
  PendingChatPayloadApplicator,
  type ActionKeys
} from '../features/ChatInput'
import type { AgentMessage, MessagePart, MessagePartTool } from '@prizm/client-core'
import { ToolCallCard, GrantPathProvider, InteractProvider } from '../components/agent'
import type { GrantPathContextValue, InteractContextValue } from '../components/agent'
import { AgentOverviewPanel } from '../components/agent/AgentOverviewPanel'
import { AssistantMessageExtra } from '../components/agent/AssistantMessageExtra'
import { FilePreviewPanel } from '../components/agent/FilePreviewPanel'
import { FileTreePanel } from '../components/agent/FileTreePanel'
import { TerminalSidebarTab } from '../components/agent/TerminalSidebarTab'
import { ThinkingDots } from '../components/agent/ThinkingDots'
import { ScrollToBottom } from '../components/agent/ScrollToBottom'
import { EmptyConversation } from '../components/agent/EmptyConversation'
import {
  toChatMessage,
  DRAFT_KEY_NEW,
  draftCache,
  setSkipNextDraftRestore,
  DraftCacheManager
} from '../components/agent/chatMessageAdapter'
import {
  fadeUp,
  panelCrossfade,
  panelCrossfadeTransition,
  EASE_SMOOTH
} from '../theme/motionPresets'
// 注册终端工具卡片渲染器（副作用导入）
import '../components/agent/TerminalToolCards'

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
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const pendingHandledRef = useRef<string | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  /** 滚动到底部 */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  /** 检测是否滚到底部 */
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setShowScrollBtn(!isNearBottom)
  }, [])

  /** Sync draft content to module-level cache for cross-page / cross-session persistence */
  const handleMarkdownContentChange = useCallback(
    (content: string) => {
      const key = currentSession?.id ?? DRAFT_KEY_NEW
      if (content.trim()) {
        draftCache.set(key, content)
      } else {
        draftCache.delete(key)
      }
    },
    [currentSession]
  )

  useEffect(() => {
    if (!pendingPayload) return
    const filesKey = pendingPayload.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
    const fileRefsKey = pendingPayload.fileRefs?.map((f) => f.path).join(',') ?? ''
    const key = `${filesKey}|${fileRefsKey}|${pendingPayload.text ?? ''}|${
      pendingPayload.sessionId ?? 'new'
    }|${pendingPayload.forceNew ? 'force' : ''}`
    if (pendingHandledRef.current === key) return
    pendingHandledRef.current = key
    setOverviewMode(false)
    if (pendingPayload.forceNew) {
      setSkipNextDraftRestore()
      setCurrentSession(null)
    } else if (pendingPayload.sessionId) {
      loadSession(pendingPayload.sessionId)
    }
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

      const refParts = refs.map((r) => r.markdown)
      const combined = [...refParts, rawText].filter(Boolean).join('\n')
      const fileRefs: import('@prizm/shared').FilePathRef[] = refs
        .filter((r) => r.type === 'file')
        .map((r) => ({
          path: r.key.replace(/%29/g, ')'),
          name: r.label
        }))

      draftCache.delete(DRAFT_KEY_NEW)
      if (session) draftCache.delete(session.id)
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

  /** 快捷 prompt 从空状态发送 */
  const handleQuickPrompt = useCallback(
    (text: string) => {
      // 直接 navigate to chat mode then rely on input
      setOverviewMode(false)
      setCurrentSession(null)
      // 设置 draft 以便在输入框中自动填入
      draftCache.set(DRAFT_KEY_NEW, text)
    },
    [setCurrentSession]
  )

  const leftActions: ActionKeys[] = ['fileUpload', 'clear']

  /** 单一消息源：服务器消息 + 乐观更新 */
  const chatData: ChatMessage[] = useMemo(() => {
    if (!currentSession) return []

    const messages: (AgentMessage & { streaming?: boolean })[] = [
      ...currentSession.messages,
      ...optimisticMessages.map((m) => ({
        ...m,
        streaming: sending && m.role === 'assistant' && m.id.startsWith('assistant-')
      }))
    ]

    const lastIdx = new Map<string, number>()
    messages.forEach((m, i) => lastIdx.set(m.id, i))
    const deduped = messages.filter((m, i) => lastIdx.get(m.id) === i)

    return deduped.map(toChatMessage)
  }, [currentSession, optimisticMessages, sending])

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
          {/* ── 左侧会话列表 ── */}
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
                  onClick={() => setOverviewMode(true)}
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

          {/* ── 中间内容区 ── */}
          <WorkNavigationContext.Provider
            value={{
              openFileAtWork: (kind: FileKind, id: string) => setPreviewFile({ kind, id }),
              pendingWorkFile: null,
              consumePendingWorkFile: () => {}
            }}
          >
            <div className="agent-content">
              <AnimatePresence mode="wait">
                {overviewMode ? (
                  <motion.div
                    key="overview"
                    className="agent-main"
                    {...panelCrossfade}
                    transition={panelCrossfadeTransition}
                  >
                    <AgentOverviewPanel
                      selectedModel={selectedModel}
                      onModelChange={setSelectedModel}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key={currentSession?.id ?? 'new'}
                    className="agent-main"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden'
                    }}
                    {...panelCrossfade}
                    transition={panelCrossfadeTransition}
                  >
                    {currentSession ? (
                      <div
                        className="agent-messages"
                        ref={messagesContainerRef}
                        onScroll={handleMessagesScroll}
                        style={{ position: 'relative' }}
                      >
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
                                        <ToolCallCard key={p.id} tc={p as MessagePartTool} />
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

                        {/* Thinking indicators with motion */}
                        <AnimatePresence>
                          {pendingInteract && sending && (
                            <motion.div
                              key="interact-indicator"
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                              style={{ padding: '8px 48px' }}
                            >
                              <ThinkingDots
                                color="var(--ant-color-warning)"
                                label="AI 正在等待您的确认…"
                              />
                            </motion.div>
                          )}
                          {thinking && sending && !pendingInteract && (
                            <motion.div
                              key="thinking-indicator"
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                              style={{ padding: '8px 48px' }}
                            >
                              <ThinkingDots label="AI 正在生成工具参数…" />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div ref={messagesEndRef} />

                        {/* Scroll to bottom button */}
                        <ScrollToBottom visible={showScrollBtn} onClick={scrollToBottom} />
                      </div>
                    ) : (
                      <EmptyConversation onSendPrompt={handleQuickPrompt} loading={loading} />
                    )}

                    {/* Error banner */}
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          className="agent-error-banner"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Input area */}
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
                              boxShadow: '0 12px 32px rgba(0,0,0,.04)',
                              transition: 'box-shadow 0.3s, border-color 0.3s'
                            }
                          }}
                        />
                      </ChatInputProvider>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── 右侧智能面板 ── */}
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
                    <AnimatePresence mode="wait">
                      {sidebarTab === 'context' ? (
                        <motion.div
                          key="context"
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column'
                          }}
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.15 }}
                        >
                          <AgentRightSidebar
                            sending={sending}
                            error={error}
                            currentSession={currentSession}
                            optimisticMessages={optimisticMessages}
                            selectedModel={selectedModel}
                            onModelChange={setSelectedModel}
                            overviewMode={false}
                          />
                        </motion.div>
                      ) : sidebarTab === 'files' ? (
                        <motion.div
                          key="files"
                          style={{ flex: 1, overflow: 'hidden' }}
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.15 }}
                        >
                          <FileTreePanel
                            scope={currentScope}
                            sessionId={currentSession?.id}
                            onPreviewFile={(relativePath) => {
                              setPreviewFile({ kind: 'document', id: relativePath })
                            }}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="terminal"
                          style={{ flex: 1, overflow: 'hidden' }}
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.15 }}
                        >
                          <TerminalSidebarTab sessionId={currentSession?.id} scope={currentScope} />
                        </motion.div>
                      )}
                    </AnimatePresence>
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
