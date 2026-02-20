/**
 * CollaborationPage — session-first collaboration workspace.
 *
 * Layout: CollabNav (left) + Session Chat (center, always visible) + RightDrawerPanel (expandable right)
 *
 * Session is the primary citizen. Document / Task / Workflow live in an expandable
 * right-side panel with tabs and a draggable split divider.
 */
import { GripVertical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, FileText, Zap, GitBranch } from 'lucide-react'
import { ActionIcon } from '@lobehub/ui'
import { Drawer } from 'antd'
import { motion } from 'motion/react'
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
import { AgentChatZone } from '../components/agent/AgentChatZone'
import { setSkipNextDraftRestore } from '../components/agent/chatMessageAdapter'
import { useDocumentNavigation } from '../context/NavigationContext'
import { useAgentSessionStore } from '../store/agentSessionStore'
import { useScopeDataStore } from '../store/scopeDataStore'
import { useWorkflowStore } from '../store/workflowStore'
import { usePrizmContext } from '../context/PrizmContext'
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
import { RightDrawerPanel } from '../components/collaboration/RightDrawerPanel'
import { CollabInteractionContext, useCollabInteractionValue } from '../hooks/useCollabInteraction'
import type { RightPanelTab } from '../components/collaboration/collabTypes'
import '../styles/collab-hub.css'

const LEFT_ACTIONS: ActionKeys[] = ['fileUpload', 'thinking', 'toolCompact', 'clear']
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

  /* Layout state */
  const layout = useCollabLayout()
  const {
    rightPanelOpen, rightPanelTab, rightPanelEntityId,
    splitPct, splitContainerRef, handleSplitPointerDown,
    openRightPanel, closeRightPanel, toggleRightPanel, switchRightTab
  } = layout

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightDetailCollapsed, setRightDetailCollapsed] = useState(false)
  const [collabDocId, setCollabDocId] = useState<string | null>(null)
  const docDirtyRef = useRef(false)
  const [hubDrawerOpen, setHubDrawerOpen] = useState(false)
  const { navigateToDocs } = useDocumentNavigation()

  /* Data sources */
  const allSessions = useAgentSessionStore((s) => s.sessions)
  const bgSessions = useMemo(
    () => allSessions.filter((s) => {
      if (s.kind !== 'background') return false
      const src = s.bgMeta?.source
      return !src || src === 'direct'
    }).sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)),
    [allSessions]
  )
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
    handleClear,
    handleQuickPrompt,
    handleMarkdownContentChange,
    sendButtonProps
  } = useAgentChatActions({
    currentSession,
    sending,
    createSession,
    sendMessage,
    stopGeneration,
    setCurrentSession,
    shouldCreateNewSession: () => !currentSession
  })

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

  /* Work nav override — opens document in right panel */
  const workNavValue = useMemo(
    () => ({
      openFileAtWork: (_kind: FileKind, id: string) => {
        setCollabDocId(id)
        openRightPanel('document', id)
      },
      pendingWorkFile: null,
      consumePendingWorkFile: () => {}
    }),
    [openRightPanel]
  )

  /* Callbacks */
  const handleLoadSession = useCallback(
    (id: string) => loadSession(id),
    [loadSession]
  )

  const handleNewSession = useCallback(() => {
    setCurrentSession(null)
  }, [setCurrentSession])

  const handleNewDocument = useCallback(async () => {
    const http = manager?.getHttpClient()
    if (!http) return
    try {
      const doc = await http.createDocument({ title: '新文档' }, currentScope)
      setCollabDocId(doc.id)
      openRightPanel('document', doc.id)
      void refreshDocuments()
    } catch {
      toast.error('创建文档失败')
    }
  }, [manager, currentScope, openRightPanel, refreshDocuments])

  const handleRefreshAll = useCallback(() => {
    void refreshDocuments()
    const wfStore = useWorkflowStore.getState()
    void wfStore.refreshRuns()
    const sessionStore = useAgentSessionStore.getState()
    if (currentScope) void sessionStore.refreshSessions(currentScope)
  }, [refreshDocuments, currentScope])

  /* Interaction API for cross-panel navigation */
  const interactionAPI = useCollabInteractionValue({
    openRightPanel,
    closeRightPanel,
    loadSession: handleLoadSession
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
      right: (
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
            title="文档面板"
            active={rightPanelOpen && rightPanelTab === 'document'}
            onClick={() => toggleRightPanel('document')}
          />
          <ActionIcon
            icon={Zap}
            size="small"
            title="任务面板"
            active={rightPanelOpen && rightPanelTab === 'task'}
            onClick={() => toggleRightPanel('task')}
          />
          <ActionIcon
            icon={GitBranch}
            size="small"
            title="工作流面板"
            active={rightPanelOpen && rightPanelTab === 'workflow'}
            onClick={() => toggleRightPanel('workflow')}
          />
        </>
      )
    }),
    [leftCollapsed, rightDetailCollapsed, rightPanelOpen, rightPanelTab, toggleRightPanel]
  )
  useRegisterHeaderSlots('agent', headerSlots)

  /* Hub drawer callbacks */
  const handleHubNavigate = useCallback(
    (panel: string) => {
      if (panel === 'agent') {
        setHubDrawerOpen(false)
      } else if (panel === 'document' || panel === 'task' || panel === 'workflow') {
        openRightPanel(panel as RightPanelTab)
        setHubDrawerOpen(false)
      }
    },
    [openRightPanel]
  )

  const handleHubSelectDocument = useCallback(
    (docId: string) => {
      setCollabDocId(docId)
      openRightPanel('document', docId)
      setHubDrawerOpen(false)
    },
    [openRightPanel]
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
              sessions={sessions}
              activeSessionId={currentSession?.id}
              sessionsLoading={loading}
              pendingInteractSessionIds={pendingInteractSessionIds}
              onLoadSession={handleLoadSession}
              onNewSession={handleNewSession}
              bgSessions={bgSessions}
              bgLoading={loading}
              rightPanelOpen={rightPanelOpen}
              rightPanelTab={rightPanelTab}
              onOpenRightPanel={openRightPanel}
              onToggleRightPanel={toggleRightPanel}
              onOpenHub={() => setHubDrawerOpen(true)}
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
                      <div className="agent-content">
                        <div className="agent-chat-area">
                          <div
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
                              inputStyle={inputStyle}
                              extraInputChildren={<CtrlLHandler />}
                            />
                          </div>
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

                  {/* Right panel */}
                  <div className="collab-split-pane" style={{ width: `calc(${100 - splitPct}% - 4px)` }}>
                    <RightDrawerPanel
                      activeTab={rightPanelTab}
                      entityId={rightPanelEntityId}
                      onTabChange={switchRightTab}
                      onClose={closeRightPanel}
                      onLoadSession={handleLoadSession}
                      activeDocId={collabDocId}
                      onActiveDocIdChange={setCollabDocId}
                      dirtyRef={docDirtyRef}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                  {/* Session-only mode: chat + optional detail sidebar */}
                  <div className="collab-session-main">
                    <div className="agent-content">
                      <div className="agent-chat-area">
                        <div
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
                            inputStyle={inputStyle}
                            extraInputChildren={<CtrlLHandler />}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Agent detail sidebar (only when right panel is closed) */}
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
                    />
                  </ResizableSidebar>
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
            sessions={sessions}
            sessionsLoading={loading}
            workflowRuns={workflowRuns}
            workflowLoading={workflowLoading}
            bgSessions={bgSessions}
            documents={documents}
            documentsLoading={documentsLoading}
            onNavigatePanel={handleHubNavigate}
            onLoadSession={handleHubLoadSession}
            onSelectDocument={handleHubSelectDocument}
            onNewSession={() => { handleNewSession(); setHubDrawerOpen(false) }}
            onNewDocument={() => { void handleNewDocument(); setHubDrawerOpen(false) }}
            onRefresh={handleRefreshAll}
          />
        </Drawer>
      </CollabInteractionContext.Provider>
    </SelectionRefProvider>
  )
}

export default memo(CollaborationPage)
