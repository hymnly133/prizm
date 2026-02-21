/**
 * CollaborationPage — session-first collaboration workspace.
 *
 * Layout: CollabNav (left) + Session Chat (center, always visible) + RightDrawerPanel (expandable right)
 *
 * Session is the primary citizen. Document / Task / Workflow live in an expandable
 * right-side panel with per-session tabs managed by collabTabStore.
 */
import {
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  FileText,
  Zap,
  GitBranch
} from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import { Drawer } from 'antd'
import { motion, AnimatePresence } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatWithFile } from '../context/ChatWithFileContext'
import { SelectionRefProvider, useSelectionRef } from '../context/SelectionRefContext'
import { WorkNavigationOverrideProvider } from '../context/WorkNavigationContext'
import { useAgent } from '../hooks/useAgent'
import { useAgentScopeData } from '../hooks/useAgentScopeData'
import { useAgentChatActions } from '../hooks/useAgentChatActions'
import { useKeepAlivePool } from '../hooks/useKeepAlivePool'
import { useScope } from '../hooks/useScope'
import { useCollabLayout } from '../hooks/useCollabLayout'
import { usePendingInteractSessionIds } from '../events/agentBackgroundStore'
import type { FileKind } from '../hooks/useFileList'
import { ResizableSidebar } from '../components/layout'
import { useRegisterHeaderSlots } from '../context/HeaderSlotsContext'
import { ChatInputProvider, useChatInputStoreApi, type ActionKeys } from '../features/ChatInput'
import type { InputRef } from '../features/ChatInput/store/initialState'
import { AgentDetailSidebar } from '../components/agent/AgentDetailSidebar'
import { AgentOverviewPanel } from '../components/agent/AgentOverviewPanel'
import { AgentChatZone } from '../components/agent/AgentChatZone'
import { CodeViewerPanel } from '../components/agent/CodeViewerPanel'
import { setSkipNextDraftRestore } from '../components/agent/chatMessageAdapter'
import { panelCrossfade, panelCrossfadeTransition } from '../theme/motionPresets'
import { useAgentSessionStore } from '../store/agentSessionStore'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useWorkflowStore } from '../store/workflowStore'
import { useCollabTabStore, EMPTY_TABS } from '../store/collabTabStore'
import { usePrizmContext } from '../context/PrizmContext'
import { isChatListSession } from '@prizm/shared'
import { toast } from '@lobehub/ui'
import '../components/agent/TerminalToolCards'
import '../components/agent/TaskToolCards'
import { TaskToolCardsConnector } from '../components/agent/TaskToolCards'
import '../components/agent/DocumentToolCards'
import { DocumentToolCardsConnector } from '../components/agent/DocumentToolCards'
import '../components/agent/WorkflowToolCards'
import { WorkflowToolCardsConnector } from '../components/agent/WorkflowToolCards'
import '../components/agent/WorkflowBuilderCard'
import '../components/agent/ScheduleCronToolCards'

import { CollabNav } from '../components/collaboration/CollabNav'
import { CollabHub } from '../components/collaboration/CollabHub'
import { UnifiedRightPanel } from '../components/collaboration/UnifiedRightPanel'
import { CollabInteractionContext, useCollabInteractionValue } from '../hooks/useCollabInteraction'
import { makeEntityTab, makeListTab } from '../components/collaboration/collabTabTypes'
import '../styles/collab-hub.css'

const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'thinking', 'toolCompact', 'skills', 'clear']
const RIGHT_ACTIONS: ActionKeys[] = []

/* ── CtrlLHandler (needed inside ChatInputProvider) ── */

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

/* ── Main component ── */

function CollaborationPage() {
  const { currentScope } = useScope()
  const { pendingPayload } = useChatWithFile()
  const { scopeItems, slashCommands } = useAgentScopeData(currentScope)
  const { manager } = usePrizmContext()
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

  /* Layout state (split pct, right panel open/close) */
  const layout = useCollabLayout()
  const {
    rightPanelOpen,
    splitPct,
    splitContainerRef,
    handleSplitPointerDown,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel
  } = layout

  const [overviewMode, setOverviewMode] = useState(() => !currentSession)
  const overviewModeRef = useRef(overviewMode)
  overviewModeRef.current = overviewMode

  const [previewFile, setPreviewFile] = useState<{ kind: FileKind; id: string } | null>(null)

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightDetailCollapsed, setRightDetailCollapsed] = useState(false)
  const [hubDrawerOpen, setHubDrawerOpen] = useState(false)

  /* Tab store: ensure tabs are loaded when session switches */
  const ensureTabsLoaded = useCollabTabStore((s) => s.ensureLoaded)
  const openTabAction = useCollabTabStore((s) => s.openTab)
  const tabsForSession = useCollabTabStore((s) =>
    currentSession?.id ? s.tabsBySession[currentSession.id] ?? EMPTY_TABS : s.globalTabs
  )

  useEffect(() => {
    ensureTabsLoaded(currentSession?.id ?? null)
  }, [currentSession?.id, ensureTabsLoaded])

  /* Data sources */
  const allSessions = useAgentSessionStore((s) => s.sessions)
  const bgSessions = useMemo(
    () =>
      allSessions
        .filter((s) => {
          if (s.kind !== 'background') return false
          const src = s.bgMeta?.source
          return !src || src === 'direct'
        })
        .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)),
    [allSessions]
  )
  const chatSessions = useMemo(() => sessions.filter((s) => isChatListSession(s)), [sessions])
  const documents = useScopeDataStore((s) => s.documents)
  const documentsLoading = useScopeDataStore((s) => s.documentsLoading)
  const refreshDocuments = useScopeDataStore((s) => s.refreshDocuments)
  const workflowRuns = useWorkflowStore((s) => s.runs)
  const workflowLoading = useWorkflowStore((s) => s.loading)

  /* Badge counts for nav */
  const activeTaskCount = useMemo(
    () => bgSessions.filter((s) => s.bgStatus === 'running' || s.bgStatus === 'pending').length,
    [bgSessions]
  )
  const activeWorkflowCount = useMemo(
    () => workflowRuns.filter((r) => r.status === 'running' || r.status === 'paused').length,
    [workflowRuns]
  )

  /* Agent chat actions */
  const {
    handleSend,
    handleClear: handleClearBase,
    handleQuickPrompt: handleQuickPromptBase,
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
    handleClearBase()
  }, [handleClearBase])

  const handleQuickPrompt = useCallback(
    (text: string) => {
      setOverviewMode(false)
      handleQuickPromptBase(text)
    },
    [handleQuickPromptBase]
  )

  const aliveSessionIds = useKeepAlivePool(currentSession?.id, sessions, 3)

  /* Handle pending chat payload */
  const pendingHandledRef = useRef<string | null>(null)
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

  /* Work nav override — open file in CodeViewerPanel (preview) */
  const workNavValue = useMemo(
    () => ({
      openFileAtWork: (kind: FileKind, id: string) => setPreviewFile({ kind, id }),
      pendingWorkFile: null,
      consumePendingWorkFile: () => {}
    }),
    []
  )

  /* Callbacks */
  const handleLoadSession = useCallback(
    (id: string) => {
      setOverviewMode(false)
      loadSession(id)
    },
    [loadSession]
  )

  const handleNewSession = useCallback(() => {
    setOverviewMode(false)
    setCurrentSession(null)
  }, [setCurrentSession])

  const handleNewDocument = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '新文档' }, currentScope)
      const sessionId = currentSessionRef.current?.id ?? null
      openTabAction(sessionId, makeEntityTab('document', doc.id, doc.title || '新文档'))
      if (!layout.rightPanelOpen) openRightPanel()
      void refreshDocuments()
    } catch {
      toast.error('创建文档失败')
    }
  }, [
    manager,
    currentScope,
    openTabAction,
    openRightPanel,
    layout.rightPanelOpen,
    refreshDocuments
  ])

  const handleRefreshAll = useCallback(() => {
    void refreshDocuments()
    const wfStore = useWorkflowStore.getState()
    void wfStore.refreshRuns()
    const sessionStore = useAgentSessionStore.getState()
    if (currentScope) void sessionStore.refreshSessions(currentScope)
  }, [refreshDocuments, currentScope])

  /* Tab-based open helpers for nav quick-access buttons */
  const handleOpenListTab = useCallback(
    (type: 'document-list' | 'task-list' | 'workflow-list') => {
      const sessionId = currentSessionRef.current?.id ?? null
      openTabAction(sessionId, makeListTab(type))
      if (!layout.rightPanelOpen) openRightPanel()
    },
    [openTabAction, openRightPanel, layout.rightPanelOpen]
  )

  const handleToggleListTab = useCallback(
    (type: 'document-list' | 'task-list' | 'workflow-list') => {
      if (layout.rightPanelOpen && tabsForSession.length > 0) {
        closeRightPanel()
      } else {
        handleOpenListTab(type)
      }
    },
    [layout.rightPanelOpen, tabsForSession.length, closeRightPanel, handleOpenListTab]
  )

  /* Interaction API for cross-panel navigation (uses tab store) */
  const interactionAPI = useCollabInteractionValue({
    openTab: (sessionId, tab) => {
      openTabAction(sessionId, tab)
      if (!layout.rightPanelOpen) openRightPanel()
    },
    closeRightPanel,
    openRightPanel,
    loadSession: handleLoadSession,
    getCurrentSessionId: () => currentSessionRef.current?.id ?? null
  })

  /* Header slots */
  const headerSlots = useMemo(
    () => ({
      left: (
        <ActionIcon
          icon={leftCollapsed ? PanelLeftOpen : PanelLeftClose}
          size="small"
          title={leftCollapsed ? '展开导航' : '收起导航'}
          onClick={() => setLeftCollapsed((c) => !c)}
        />
      ),
      right: !overviewMode ? (
        <>
          {!rightPanelOpen && (
            <ActionIcon
              icon={rightDetailCollapsed ? PanelRightOpen : PanelRightClose}
              size="small"
              title={rightDetailCollapsed ? '展开详情' : '收起详情'}
              onClick={() => setRightDetailCollapsed((c) => !c)}
              style={{ marginRight: 4 }}
            />
          )}
          <ActionIcon
            icon={FileText}
            size="small"
            title="文档"
            onClick={() => handleToggleListTab('document-list')}
          />
          <ActionIcon
            icon={Zap}
            size="small"
            title="任务"
            onClick={() => handleToggleListTab('task-list')}
          />
          <ActionIcon
            icon={GitBranch}
            size="small"
            title="工作流"
            onClick={() => handleToggleListTab('workflow-list')}
          />
        </>
      ) : undefined
    }),
    [leftCollapsed, rightDetailCollapsed, rightPanelOpen, overviewMode, handleToggleListTab]
  )
  useRegisterHeaderSlots('agent', headerSlots)

  /* Hub drawer callbacks — open items as tabs */
  const handleHubNavigate = useCallback(
    (panel: string) => {
      if (panel === 'agent') {
        setHubDrawerOpen(false)
      } else if (panel === 'document' || panel === 'task' || panel === 'workflow') {
        handleOpenListTab(`${panel}-list` as 'document-list' | 'task-list' | 'workflow-list')
        setHubDrawerOpen(false)
      }
    },
    [handleOpenListTab]
  )

  const handleHubSelectDocument = useCallback(
    (docId: string) => {
      const sessionId = currentSessionRef.current?.id ?? null
      openTabAction(sessionId, makeEntityTab('document', docId, '文档'))
      if (!layout.rightPanelOpen) openRightPanel()
      setHubDrawerOpen(false)
    },
    [openTabAction, openRightPanel, layout.rightPanelOpen]
  )

  const handleHubLoadSession = useCallback(
    (id: string) => {
      loadSession(id)
      setHubDrawerOpen(false)
    },
    [loadSession]
  )

  /* Input style adapts to whether right panel is open */
  const inputStyle = useMemo(
    () =>
      rightPanelOpen
        ? { minHeight: 72, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,.03)' }
        : { minHeight: 88, borderRadius: 20, boxShadow: '0 12px 32px rgba(0,0,0,.04)' },
    [rightPanelOpen]
  )

  return (
    <SelectionRefProvider>
      <CollabInteractionContext.Provider value={interactionAPI}>
        <TaskToolCardsConnector api={interactionAPI} />
        <DocumentToolCardsConnector api={interactionAPI} />
        <WorkflowToolCardsConnector api={interactionAPI} />
        <section className="collab-page">
          {/* Left: session navigation */}
          <ResizableSidebar
            side="left"
            storageKey="collab-nav"
            defaultWidth={220}
            collapsed={leftCollapsed}
            onCollapsedChange={setLeftCollapsed}
          >
            <CollabNav
              sessions={chatSessions}
              activeSessionId={currentSession?.id}
              sessionsLoading={loading}
              pendingInteractSessionIds={pendingInteractSessionIds}
              onLoadSession={handleLoadSession}
              onNewSession={handleNewSession}
              bgSessions={bgSessions}
              bgLoading={loading}
              rightPanelOpen={rightPanelOpen}
              rightPanelTab="document"
              onOpenRightPanel={() => openRightPanel()}
              onToggleRightPanel={() => toggleRightPanel()}
              onOpenHub={() => setHubDrawerOpen(true)}
              showOverviewTab
              overviewActive={overviewMode}
              onOverviewClick={() => setOverviewMode(true)}
              documentCount={documents.length}
              activeTaskCount={activeTaskCount}
              activeWorkflowCount={activeWorkflowCount}
            />
          </ResizableSidebar>

          {/* Center + Right: session chat + optional right panel */}
          <WorkNavigationOverrideProvider value={workNavValue}>
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
              {rightPanelOpen ? (
                <div className="collab-split-container" ref={splitContainerRef}>
                  {/* Main session area */}
                  <div className="collab-split-pane" style={{ width: `calc(${splitPct}% - 4px)` }}>
                    <div className="collab-session-main">
                      <div
                        className={`agent-content${
                          previewFile && !overviewMode ? ' agent-content--split' : ''
                        }`}
                      >
                        {previewFile && !overviewMode && (
                          <ResizableSidebar
                            side="left"
                            storageKey="collab-code-viewer"
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
                                key="chat"
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
                                  inputStyle={inputStyle}
                                  extraInputChildren={<CtrlLHandler />}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Draggable divider */}
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

                  {/* Right panel — per-session tabs */}
                  <div
                    className="collab-split-pane"
                    style={{ width: `calc(${100 - splitPct}% - 4px)` }}
                  >
                    <UnifiedRightPanel
                      contextId={currentSession?.id ?? null}
                      onClose={closeRightPanel}
                      onLoadSession={handleLoadSession}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                  {/* Session-only mode: overview/chat + optional code viewer + detail sidebar */}
                  <div className="collab-session-main">
                    <div
                      className={`agent-content${
                        previewFile && !overviewMode ? ' agent-content--split' : ''
                      }`}
                    >
                      {previewFile && !overviewMode && (
                        <ResizableSidebar
                          side="left"
                          storageKey="collab-code-viewer"
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
                              key="chat"
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
                                inputStyle={inputStyle}
                                extraInputChildren={<CtrlLHandler />}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* Agent detail sidebar (only when right panel is closed) */}
                  {!overviewMode && (
                    <ResizableSidebar
                      side="right"
                      storageKey="collab-agent-right"
                      defaultWidth={280}
                      collapsed={rightDetailCollapsed}
                      onCollapsedChange={setRightDetailCollapsed}
                    >
                      <AgentDetailSidebar
                        sending={sending}
                        error={error}
                        currentSession={currentSession}
                        optimisticMessages={optimisticMessages}
                        selectedModel={selectedModel}
                        onModelChange={setSelectedModel}
                        scope={currentScope}
                        onPreviewFile={(relativePath) =>
                          setPreviewFile({ kind: 'document', id: relativePath })
                        }
                      />
                    </ResizableSidebar>
                  )}
                </div>
              )}
            </ChatInputProvider>
          </WorkNavigationOverrideProvider>
        </section>

        {/* Hub overview drawer */}
        <Drawer
          open={hubDrawerOpen}
          onClose={() => setHubDrawerOpen(false)}
          placement="left"
          width={560}
          title={null}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          <CollabHub
            scope={currentScope}
            sessions={chatSessions}
            sessionsLoading={loading}
            workflowRuns={workflowRuns}
            workflowLoading={workflowLoading}
            bgSessions={bgSessions}
            documents={documents}
            documentsLoading={documentsLoading}
            onNavigatePanel={handleHubNavigate}
            onLoadSession={handleHubLoadSession}
            onSelectDocument={handleHubSelectDocument}
            onNewSession={() => {
              handleNewSession()
              setHubDrawerOpen(false)
            }}
            onNewDocument={() => {
              void handleNewDocument()
              setHubDrawerOpen(false)
            }}
            onRefresh={handleRefreshAll}
          />
        </Drawer>
      </CollabInteractionContext.Provider>
    </SelectionRefProvider>
  )
}

export default memo(CollaborationPage)
