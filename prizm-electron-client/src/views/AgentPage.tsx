/**
 * Agent 页面 - 现代化 UI 重构
 * 三栏布局：会话列表 + 消息区(ChatList) + 智能右侧栏
 * 中央区域支持水平分割：CodeViewer | Chat（类 IDE 体验）
 *
 * 会话切换使用 KeepAlive 池（SessionChatProvider + SessionChatPanel），
 * 最近 N 个会话保持 DOM 挂载，切换时只翻转 CSS display → O(1) 切换。
 *
 * 共享组件：AgentSessionList、useAgentChatActions 与协作页的 AgentPane 共用。
 */
import { ActionIcon } from '@lobehub/ui'
import { motion, AnimatePresence } from 'motion/react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { Profiler, useRef, useState, useMemo, useCallback, useEffect, memo } from 'react'
import type { ProfilerOnRenderCallback } from 'react'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { SelectionRefProvider, useSelectionRef } from '../context/SelectionRefContext'
import { WorkNavigationOverrideProvider } from '../context/WorkNavigationContext'
import { SessionChatProvider } from '../context/SessionChatContext'
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useAgentChatActions } from '../hooks/useAgentChatActions'
import { useScope } from '../hooks/useScope'
import { usePendingInteractSessionIds } from '../events/agentBackgroundStore'
import type { FileKind } from '../hooks/useFileList'
import { ResizableSidebar } from '../components/layout'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import {
  ChatInputProvider,
  DesktopChatInput,
  PendingChatPayloadApplicator,
  useChatInputStoreApi,
  type ActionKeys
} from '../features/ChatInput'
import type { InputRef } from '../features/ChatInput/store/initialState'
import { AgentOverviewPanel } from '../components/agent/AgentOverviewPanel'
import { AgentSessionList } from '../components/agent/AgentSessionList'
import { AgentDetailSidebar } from '../components/agent/AgentDetailSidebar'
import { CodeViewerPanel } from '../components/agent/CodeViewerPanel'
import { EmptyConversation } from '../components/agent/EmptyConversation'
import { SessionChatPanel } from '../components/agent/SessionChatPanel'
import {
  DRAFT_KEY_NEW,
  setSkipNextDraftRestore,
  DraftCacheManager
} from '../components/agent/chatMessageAdapter'
import { panelCrossfade, panelCrossfadeTransition } from '../theme/motionPresets'
import '../components/agent/TerminalToolCards'

const MAX_KEPT_ALIVE = 3
const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

const _profilerCallback: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  if (actualDuration > 3) {
    console.debug(
      `[perf][Profiler] %c${id}%c ${phase} %c${actualDuration.toFixed(
        1
      )}ms%c (base: ${baseDuration.toFixed(1)}ms)`,
      'color:#E91E63;font-weight:bold',
      '',
      'color:#FF5722;font-weight:bold',
      'color:#999'
    )
  }
}

/**
 * Ctrl+L 快捷键处理组件
 * 必须放在 ChatInputProvider + SelectionRefProvider 内部。
 */
function CtrlLHandler() {
  const { currentSelection } = useSelectionRef()
  const storeApi = useChatInputStoreApi()
  const selRef = useRef(currentSelection)
  selRef.current = currentSelection

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'l') return
      const sel = selRef.current
      if (!sel || !sel.text.trim()) return
      e.preventDefault()

      const parts = (sel.filePath ?? 'snippet').replace(/\\/g, '/').split('/')
      const fileName = parts[parts.length - 1] || 'snippet'
      const lineRange =
        sel.startLine != null && sel.endLine != null
          ? sel.startLine === sel.endLine
            ? `:${sel.startLine}`
            : `:${sel.startLine}-${sel.endLine}`
          : ''
      const lang = sel.language ?? ''

      const ref: InputRef = {
        type: 'snippet',
        key: `snippet:${sel.filePath ?? 'unknown'}#${Date.now()}`,
        label: `${fileName}${lineRange}`,
        markdown: `Selected from \`${sel.filePath ?? 'unknown'}\`${
          lineRange ? ` (lines ${lineRange.slice(1)})` : ''
        }:\n\`\`\`${lang}\n${sel.text}\n\`\`\``
      }
      storeApi.getState().addInputRef(ref)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [storeApi])

  return null
}

function AgentPage() {
  const _renderStart = performance.now()
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

  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession

  const pendingInteractSessionIds = usePendingInteractSessionIds()
  const [overviewMode, setOverviewMode] = useState(!currentSession)
  const overviewModeRef = useRef(overviewMode)
  overviewModeRef.current = overviewMode
  const [previewFile, setPreviewFile] = useState<{ kind: FileKind; id: string } | null>(null)

  const workNavValue = useMemo(
    () => ({
      openFileAtWork: (kind: FileKind, id: string) => setPreviewFile({ kind, id }),
      pendingWorkFile: null,
      consumePendingWorkFile: () => {}
    }),
    []
  )

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  const headerSlots = useMemo(
    () => ({
      left: (
        <ActionIcon
          icon={leftCollapsed ? PanelLeftOpen : PanelLeftClose}
          size="small"
          title={leftCollapsed ? '展开会话列表' : '收起会话列表'}
          onClick={() => setLeftCollapsed((c) => !c)}
        />
      ),
      right: !overviewMode ? (
        <ActionIcon
          icon={rightCollapsed ? PanelRightOpen : PanelRightClose}
          size="small"
          title={rightCollapsed ? '展开侧边面板' : '收起侧边面板'}
          onClick={() => setRightCollapsed((c) => !c)}
          style={{ marginRight: 4 }}
        />
      ) : undefined
    }),
    [leftCollapsed, rightCollapsed, overviewMode]
  )
  useRegisterHeaderSlots('agent', headerSlots)

  // --- KeepAlive 池：追踪最近访问的 N 个会话 ID（LRU 策略）---
  const alivePoolRef = useRef<string[]>([])
  const aliveSessionIds = useMemo(() => {
    const validIds = new Set(sessions.map((s) => s.id))
    let pool = alivePoolRef.current.filter((id) => validIds.has(id))

    const currentId = currentSession?.id
    if (currentId && validIds.has(currentId)) {
      if (pool[0] !== currentId) {
        const isHit = pool.includes(currentId)
        pool = [currentId, ...pool.filter((id) => id !== currentId)].slice(0, MAX_KEPT_ALIVE)
        console.debug(
          `[perf] KeepAlive pool update: %c${isHit ? 'HIT ✓' : 'MISS (new mount)'}`,
          isHit ? 'color:#4CAF50;font-weight:bold' : 'color:#FF5722;font-weight:bold',
          { active: currentId.slice(0, 8), pool: pool.map((id) => id.slice(0, 8)) }
        )
      }
    }

    alivePoolRef.current = pool
    return pool
  }, [currentSession?.id, sessions])

  const pendingHandledRef = useRef<string | null>(null)

  // --- 共享聊天操作 ---
  const {
    handleSend,
    handleClear: _handleClear,
    handleQuickPrompt: _handleQuickPrompt,
    handleMarkdownContentChange,
    sendButtonProps
  } = useAgentChatActions({
    currentSession,
    sending,
    createSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    shouldCreateNewSession: () => overviewModeRef.current,
    onBeforeCreateSession: () => setOverviewMode(false)
  })

  /** 清空：切换到新对话准备态（不创建服务端会话），同时退出 overview */
  const handleClear = useCallback(() => {
    setOverviewMode(false)
    _handleClear()
  }, [_handleClear])

  /** 快捷 prompt 从空状态发送 */
  const handleQuickPrompt = useCallback(
    (text: string) => {
      setOverviewMode(false)
      _handleQuickPrompt(text)
    },
    [_handleQuickPrompt]
  )

  useEffect(() => {
    if (!pendingPayload) return
    const filesKey = pendingPayload.files?.map((f) => `${f.kind}:${f.id}`).join(',') ?? ''
    const fileRefsKey = pendingPayload.fileRefs?.map((f) => f.path).join(',') ?? ''
    const key = `${filesKey}|${fileRefsKey}|${pendingPayload.text ?? ''}|${
      pendingPayload.sessionId ?? 'new'
    }|${pendingPayload.forceNew ? 'force' : ''}|${pendingPayload.targetMessageId ?? ''}`
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

  const activeSessionId = overviewMode ? undefined : currentSession?.id

  /** 会话列表点击：退出 overview 并加载会话 */
  const handleLoadSession = useCallback(
    (id: string) => {
      const _clickT0 = performance.now()
      console.debug(
        `[perf] ▶ Session click: ${id.slice(0, 8)}`,
        `(from ${currentSessionRef.current?.id?.slice(0, 8) ?? 'none'})`
      )
      performance.mark('session-switch:click')
      setOverviewMode(false)
      loadSession(id)
      const _clickT1 = performance.now()
      console.debug(
        `[perf] ▶ Click handler sync portion: %c${(_clickT1 - _clickT0).toFixed(1)}ms`,
        'color:#F44336;font-weight:bold'
      )
      requestAnimationFrame(() => {
        console.debug(
          `[perf] ▶ Click → next frame (paint): %c${(performance.now() - _clickT0).toFixed(1)}ms`,
          'color:#FF5722;font-weight:bold'
        )
      })
    },
    [loadSession]
  )

  const handleNewSession = useCallback(() => {
    setOverviewMode(false)
    setCurrentSession(null)
  }, [setCurrentSession])

  const _hooksEnd = performance.now()
  if (_hooksEnd - _renderStart > 3) {
    console.debug(
      `[perf] AgentPage hooks phase %c${(_hooksEnd - _renderStart).toFixed(1)}ms`,
      'color:#673AB7;font-weight:bold'
    )
  }

  return (
    <SelectionRefProvider>
      <section className="agent-page">
        {/* ── 左侧会话列表 ── */}
        <Profiler id="SessionList" onRender={_profilerCallback}>
          <ResizableSidebar
            side="left"
            storageKey="agent-sessions"
            defaultWidth={220}
            collapsed={leftCollapsed}
            onCollapsedChange={setLeftCollapsed}
          >
            <AgentSessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              loading={loading}
              pendingInteractSessionIds={pendingInteractSessionIds}
              onDeleteSession={deleteSession}
              onLoadSession={handleLoadSession}
              onNewSession={handleNewSession}
              showOverviewTab
              overviewActive={overviewMode}
              onOverviewClick={() => setOverviewMode(true)}
            />
          </ResizableSidebar>
        </Profiler>

        {/* ── 中间内容区 ── */}
        <WorkNavigationOverrideProvider value={workNavValue}>
          <Profiler id="ChatInputProvider" onRender={_profilerCallback}>
            <ChatInputProvider
              leftActions={LEFT_ACTIONS}
              rightActions={RIGHT_ACTIONS}
              scopeItems={scopeItems}
              scopeSlashCommands={slashCommands}
              sendButtonProps={sendButtonProps}
              onSend={handleSend}
              onMarkdownContentChange={handleMarkdownContentChange}
              allowExpand
            >
              <div
                className={`agent-content${
                  previewFile && !overviewMode ? ' agent-content--split' : ''
                }`}
              >
                {/* ── 文件查看器 ── */}
                {previewFile && !overviewMode && (
                  <ResizableSidebar
                    side="left"
                    storageKey="agent-code-viewer"
                    defaultWidth={480}
                    minWidth={240}
                    maxWidth={800}
                  >
                    <CodeViewerPanel
                      fileRef={previewFile}
                      scope={currentScope}
                      onClose={() => setPreviewFile(null)}
                    />
                  </ResizableSidebar>
                )}

                {/* ── Chat 区域 ── */}
                <div className="agent-chat-area">
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
                        key="chat-mode"
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
                        {/* ── KeepAlive 池 ── */}
                        <Profiler id="KeepAlivePool" onRender={_profilerCallback}>
                          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                            {aliveSessionIds.map((id) => (
                              <div
                                key={id}
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: id === currentSession?.id ? 'flex' : 'none',
                                  flexDirection: 'column'
                                }}
                              >
                                <SessionChatProvider
                                  sessionId={id}
                                  scope={currentScope}
                                  active={id === currentSession?.id}
                                >
                                  <SessionChatPanel />
                                </SessionChatProvider>
                              </div>
                            ))}
                            {!currentSession && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  flexDirection: 'column'
                                }}
                              >
                                <EmptyConversation
                                  onSendPrompt={handleQuickPrompt}
                                  loading={loading}
                                />
                              </div>
                            )}
                          </div>
                        </Profiler>

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

                        {/* Input area — stable across all session transitions */}
                        <Profiler id="ChatInput" onRender={_profilerCallback}>
                          <div className="agent-input-wrap agent-input-floating">
                            <DraftCacheManager sessionId={currentSession?.id ?? DRAFT_KEY_NEW} />
                            <PendingChatPayloadApplicator />
                            <CtrlLHandler />
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
                          </div>
                        </Profiler>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* ── 右侧智能面板 ── */}
              <Profiler id="RightSidebar" onRender={_profilerCallback}>
                {!overviewMode && (
                  <ResizableSidebar
                    side="right"
                    storageKey="agent-right"
                    defaultWidth={280}
                    collapsed={rightCollapsed}
                    onCollapsedChange={setRightCollapsed}
                  >
                    <AgentDetailSidebar
                      sending={sending}
                      error={error}
                      currentSession={currentSession}
                      optimisticMessages={optimisticMessages}
                      selectedModel={selectedModel}
                      onModelChange={setSelectedModel}
                      scope={currentScope}
                      onPreviewFile={(relativePath) => {
                        setPreviewFile({ kind: 'document', id: relativePath })
                      }}
                    />
                  </ResizableSidebar>
                )}
              </Profiler>
            </ChatInputProvider>
          </Profiler>
        </WorkNavigationOverrideProvider>
      </section>
    </SelectionRefProvider>
  )
}

export default memo(AgentPage)
