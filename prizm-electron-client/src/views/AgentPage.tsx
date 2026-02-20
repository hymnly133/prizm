/**
 * Agent 页面 — 三栏布局：会话列表 + 消息区 + 智能右侧栏
 *
 * 支持两种布局模式：
 * 1. 纯聊天模式（默认）— 三栏：会话列表 + 聊天/总览 + 详情侧栏
 * 2. 分屏协作模式 — 聊天 + 文档编辑器并排（原 CollaborationPage 功能）
 */
import { ActionIcon } from '@lobehub/ui'
import { motion, AnimatePresence } from 'motion/react'
import {
  Columns2,
  GripVertical,
  MessageSquare,
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
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useAgentChatActions } from '../hooks/useAgentChatActions'
import { useKeepAlivePool } from '../hooks/useKeepAlivePool'
import { useScope } from '../hooks/useScope'
import { usePendingInteractSessionIds } from '../events/agentBackgroundStore'
import type { FileKind } from '../hooks/useFileList'
import { ResizableSidebar } from '../components/layout'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import { ChatInputProvider, useChatInputStoreApi, type ActionKeys } from '../features/ChatInput'
import type { InputRef } from '../features/ChatInput/store/initialState'
import { AgentOverviewPanel } from '../components/agent/AgentOverviewPanel'
import { AgentSessionList } from '../components/agent/AgentSessionList'
import { AgentDetailSidebar } from '../components/agent/AgentDetailSidebar'
import { AgentChatZone } from '../components/agent/AgentChatZone'
import { CodeViewerPanel } from '../components/agent/CodeViewerPanel'
import { setSkipNextDraftRestore } from '../components/agent/chatMessageAdapter'
import { DocumentPane } from '../components/collaboration'
import { useDocumentNavigation } from '../context/NavigationContext'
import { panelCrossfade, panelCrossfadeTransition } from '../theme/motionPresets'
import '../components/agent/TerminalToolCards'
import '../components/agent/TaskToolCards'
import { TaskToolCardsConnector } from '../components/agent/TaskToolCards'

const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'thinking', 'toolCompact', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

const SPLIT_MODE_KEY = 'prizm-agent-split-mode'
const SPLIT_PCT_KEY = 'prizm-agent-split-pct'

function loadSplitMode(): boolean {
  try {
    return localStorage.getItem(SPLIT_MODE_KEY) === '1'
  } catch {
    return false
  }
}
function persistSplitMode(v: boolean) {
  try {
    localStorage.setItem(SPLIT_MODE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}
function loadSplitPct(): number {
  try {
    const v = parseFloat(localStorage.getItem(SPLIT_PCT_KEY) ?? '')
    return v >= 20 && v <= 80 ? v : 50
  } catch {
    return 50
  }
}
function persistSplitPct(v: number) {
  try {
    localStorage.setItem(SPLIT_PCT_KEY, String(v))
  } catch {
    /* ignore */
  }
}

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
 * Ctrl+L 快捷键处理组件 — 必须放在 ChatInputProvider + SelectionRefProvider 内部。
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

  const [splitMode, setSplitMode] = useState(loadSplitMode)
  const [splitPct, setSplitPct] = useState(loadSplitPct)
  const [collabDocId, setCollabDocId] = useState<string | null>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const splitDraggingRef = useRef(false)
  const splitRafRef = useRef<number | null>(null)
  const docDirtyRef = useRef(false)
  const { navigateToDocs } = useDocumentNavigation()

  const toggleSplitMode = useCallback(() => {
    setSplitMode((prev) => {
      const next = !prev
      persistSplitMode(next)
      return next
    })
  }, [])

  const collabWorkNavOverride = useMemo(
    () => ({
      openFileAtWork: (kind: FileKind, id: string) => {
        if (kind === 'document') setCollabDocId(id)
      },
      pendingWorkFile: null,
      consumePendingWorkFile: () => {}
    }),
    []
  )

  const workNavValue = useMemo(
    () =>
      splitMode
        ? collabWorkNavOverride
        : {
            openFileAtWork: (kind: FileKind, id: string) => setPreviewFile({ kind, id }),
            pendingWorkFile: null,
            consumePendingWorkFile: () => {}
          },
    [splitMode, collabWorkNavOverride]
  )

  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    splitDraggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!splitDraggingRef.current || !splitContainerRef.current) return
      if (splitRafRef.current != null) cancelAnimationFrame(splitRafRef.current)
      splitRafRef.current = requestAnimationFrame(() => {
        splitRafRef.current = null
        const rect = splitContainerRef.current!.getBoundingClientRect()
        const x = e.clientX - rect.left
        setSplitPct(Math.min(80, Math.max(20, (x / rect.width) * 100)))
      })
    }
    const onUp = () => {
      if (!splitDraggingRef.current) return
      splitDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (splitRafRef.current != null) cancelAnimationFrame(splitRafRef.current)
      setSplitPct((cur) => {
        persistSplitPct(cur)
        return cur
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  const headerSlots = useMemo(
    () => ({
      left: (
        <>
          <ActionIcon
            icon={leftCollapsed ? PanelLeftOpen : PanelLeftClose}
            size="small"
            title={leftCollapsed ? '展开会话列表' : '收起会话列表'}
            onClick={() => setLeftCollapsed((c) => !c)}
          />
          <ActionIcon
            icon={splitMode ? MessageSquare : Columns2}
            size="small"
            title={splitMode ? '退出分屏协作' : '分屏协作（聊天 + 文档）'}
            active={splitMode}
            onClick={toggleSplitMode}
          />
        </>
      ),
      right:
        !overviewMode && !splitMode ? (
          <ActionIcon
            icon={rightCollapsed ? PanelRightOpen : PanelRightClose}
            size="small"
            title={rightCollapsed ? '展开侧边面板' : '收起侧边面板'}
            onClick={() => setRightCollapsed((c) => !c)}
            style={{ marginRight: 4 }}
          />
        ) : undefined
    }),
    [leftCollapsed, rightCollapsed, overviewMode, splitMode, toggleSplitMode]
  )
  useRegisterHeaderSlots('agent', headerSlots)

  const aliveSessionIds = useKeepAlivePool(currentSession?.id, sessions, 3)

  const pendingHandledRef = useRef<string | null>(null)

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

  const handleClear = useCallback(() => {
    setOverviewMode(false)
    _handleClear()
  }, [_handleClear])

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

  const handleLoadSession = useCallback(
    (id: string) => {
      const _clickT0 = performance.now()
      console.debug(
        `[perf] Session click: ${id.slice(0, 8)}`,
        `(from ${currentSessionRef.current?.id?.slice(0, 8) ?? 'none'})`
      )
      performance.mark('session-switch:click')
      setOverviewMode(false)
      loadSession(id)
      const _clickT1 = performance.now()
      console.debug(
        `[perf] Click handler sync: %c${(_clickT1 - _clickT0).toFixed(1)}ms`,
        'color:#F44336;font-weight:bold'
      )
      requestAnimationFrame(() => {
        console.debug(
          `[perf] Click → next frame: %c${(performance.now() - _clickT0).toFixed(1)}ms`,
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
      <TaskToolCardsConnector />
      <section className="agent-page">
        {/* Left: session list */}
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

        {/* Center: chat content */}
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
              {splitMode && !overviewMode ? (
                /* ── 分屏协作模式：聊天 + 文档并排 ── */
                <div className="collab-split-container" ref={splitContainerRef}>
                  <div className="collab-split-pane" style={{ width: `calc(${splitPct}% - 4px)` }}>
                    <div className="agent-content">
                      <div className="agent-chat-area">
                        <motion.div
                          key="chat-split"
                          className="agent-main"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            flex: 1,
                            minHeight: 0,
                            overflow: 'hidden'
                          }}
                        >
                          <AgentChatZone
                            scope={currentScope}
                            currentSession={currentSession}
                            aliveSessionIds={aliveSessionIds}
                            error={error}
                            loading={loading}
                            onQuickPrompt={handleQuickPrompt}
                            onClear={handleClear}
                            inputStyle={{
                              minHeight: 72,
                              borderRadius: 16,
                              boxShadow: '0 8px 24px rgba(0,0,0,.03)'
                            }}
                            extraInputChildren={<CtrlLHandler />}
                          />
                        </motion.div>
                      </div>
                    </div>
                  </div>
                  <div
                    className="collab-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuenow={Math.round(splitPct)}
                    onPointerDown={handleSplitPointerDown}
                  >
                    <div className="collab-resize-handle-bar">
                      <GripVertical size={12} />
                    </div>
                  </div>
                  <div
                    className="collab-split-pane"
                    style={{ width: `calc(${100 - splitPct}% - 4px)` }}
                  >
                    <DocumentPane
                      onOpenFullPage={(docId) => {
                        if (docId) navigateToDocs(docId)
                      }}
                      dirtyRef={docDirtyRef}
                      sidebarSide="right"
                      activeDocId={collabDocId}
                      onActiveDocIdChange={setCollabDocId}
                    />
                  </div>
                </div>
              ) : (
                /* ── 标准聊天模式 ── */
                <>
                  <div
                    className={`agent-content${
                      previewFile && !overviewMode ? ' agent-content--split' : ''
                    }`}
                  >
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
                              onLoadSession={handleLoadSession}
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
                            <AgentChatZone
                              scope={currentScope}
                              currentSession={currentSession}
                              aliveSessionIds={aliveSessionIds}
                              error={error}
                              loading={loading}
                              onQuickPrompt={handleQuickPrompt}
                              onClear={handleClear}
                              inputStyle={{
                                minHeight: 88,
                                borderRadius: 20,
                                boxShadow: '0 12px 32px rgba(0,0,0,.04)'
                              }}
                              extraInputChildren={<CtrlLHandler />}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Right: detail sidebar */}
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
                </>
              )}
            </ChatInputProvider>
          </Profiler>
        </WorkNavigationOverrideProvider>
      </section>
    </SelectionRefProvider>
  )
}

export default memo(AgentPage)
