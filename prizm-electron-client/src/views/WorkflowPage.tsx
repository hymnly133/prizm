/**
 * WorkflowPage — 工作流独立页面（与协作页架构对齐）.
 *
 * 工作流项为一等公民：左侧为工作流/会话列表，主区为选中的工作流内容（总览 / 定义详情 / 运行详情 / 管理会话聊天）。
 * 右侧为标签页侧边栏，复用 collabTabStore 的 globalTabs + CollabTabBar/CollabTabContent，用于浏览文档、任务、工作流列表及打开定义/会话等附加页面。
 */

import { useEffect, useCallback, useMemo, useState } from 'react'
import { Button, message, Modal } from 'antd'
import { ArrowLeft, GripVertical } from 'lucide-react'
import { Icon } from '@lobehub/ui'
import type { WorkflowDefRecord } from '@prizm/shared'
import { getWorkflowManagementSessionLabel } from '@prizm/shared'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useWorkflowPageState } from '../hooks/useWorkflowPageState'
import { useWorkflowLayout } from '../hooks/useWorkflowLayout'
import { useWorkflowStore, subscribeWorkflowEvents } from '../store/workflowStore'
import { useCollabTabStore } from '../store/collabTabStore'
import { makeEntityTab, makeTabId } from '../components/collaboration/collabTabTypes'
import { useNavigation } from '../context/NavigationContext'
import { ResizableSidebar } from '../components/layout'
import { WorkflowSidebar } from '../components/workflow/WorkflowSidebar'
import { WorkflowOverview } from '../components/workflow/WorkflowOverview'
import { WorkflowDefDetail } from '../components/workflow/WorkflowDefDetail'
import { WorkflowRunDetailPanel } from '../components/workflow/WorkflowRunDetailPanel'
import { WorkflowChatZone } from '../components/workflow/WorkflowChatZone'
import { UnifiedRightPanel } from '../components/collaboration/UnifiedRightPanel'
import { useAgentSessionStore } from '../store/agentSessionStore'
import {
  WorkflowCreateChoice,
  type WorkflowCreateMode
} from '../components/workflow/WorkflowCreateChoice'
import { WorkflowEditor } from '../components/workflow/editor'
import '../styles/collab-hub.css'
import '../styles/workflow-page.css'

/** 创建流程步骤（仅图/YAML）；null 表示未在创建流程中。对话创建不占创建流程，直接选中 session 独占主区。 */
type CreateStep = 'choose' | 'graph' | 'yaml' | null

export default function WorkflowPage() {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()
  const { consumePendingWorkflowCreate, consumePendingWorkflowDef } = useNavigation()

  const bind = useWorkflowStore((s) => s.bind)
  const runs = useWorkflowStore((s) => s.runs)
  const defs = useWorkflowStore((s) => s.defs)
  const managementSessions = useWorkflowStore((s) => s.managementSessions)
  const loading = useWorkflowStore((s) => s.loading)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const refreshManagementSessions = useWorkflowStore((s) => s.refreshManagementSessions)
  const createPendingManagementSession = useWorkflowStore((s) => s.createPendingManagementSession)
  const createManagementSession = useWorkflowStore((s) => s.createManagementSession)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const deleteDef = useWorkflowStore((s) => s.deleteDef)

  const pageState = useWorkflowPageState()
  const {
    selectedDefId,
    selectedRunId,
    selectedManagementSessionId,
    pendingInitialRunRef,
    viewMode,
    selectDef,
    selectRun,
    selectManagementSession,
    setPendingInitialRunRef,
    clearPendingInitialRunRef,
    goBack,
    setTab,
    setSearch,
    clearSelection
  } = pageState
  const { activeTab } = pageState

  const layout = useWorkflowLayout()
  const {
    rightPanelOpen,
    splitPct,
    splitContainerRef,
    handleSplitPointerDown,
    openRightPanel,
    closeRightPanel
  } = layout

  const openTab = useCollabTabStore((s) => s.openTab)
  const closeTab = useCollabTabStore((s) => s.closeTab)
  const ensureTabsLoaded = useCollabTabStore((s) => s.ensureLoaded)

  const [createStep, setCreateStep] = useState<CreateStep>(null)
  const [creatingSession, setCreatingSession] = useState(false)

  const loadSession = useAgentSessionStore((s) => s.loadSession)
  const deleteSession = useAgentSessionStore((s) => s.deleteSession)

  useEffect(() => {
    ensureTabsLoaded(null)
  }, [ensureTabsLoaded])

  useEffect(() => {
    if (currentScope && selectedManagementSessionId) {
      void loadSession(selectedManagementSessionId, currentScope)
    }
  }, [currentScope, selectedManagementSessionId, loadSession])

  useEffect(() => {
    if (!manager || !currentScope) return
    const http = manager.getHttpClient()
    bind(http, currentScope)
  }, [manager, currentScope, bind])

  useEffect(() => {
    const unsub = subscribeWorkflowEvents()
    return () => unsub()
  }, [])

  useEffect(() => {
    const pending = consumePendingWorkflowCreate()
    if (pending?.initialPrompt) {
      createPendingManagementSession(pending.initialPrompt).then((sessionId) => {
        if (sessionId) {
          selectManagementSession(sessionId, null)
        }
      })
    }
  }, [consumePendingWorkflowCreate, createPendingManagementSession, selectManagementSession])

  useEffect(() => {
    const pending = consumePendingWorkflowDef()
    if (pending?.defId) {
      selectDef(pending.defId)
    }
  }, [consumePendingWorkflowDef, selectDef])

  const selectedDef = useMemo<WorkflowDefRecord | undefined>(
    () => defs.find((d) => d.id === selectedDefId),
    [defs, selectedDefId]
  )

  useEffect(() => {
    if (selectedDefId && !selectedDef) clearSelection()
  }, [selectedDefId, selectedDef, clearSelection])

  const handleRunWorkflow = useCallback(
    (name: string, args?: Record<string, unknown>) => {
      void runWorkflow({ workflow_name: name, args }).then((result) => {
        if (result) {
          message.success('工作流已启动')
          void refreshRuns()
        }
      })
    },
    [runWorkflow, refreshRuns]
  )

  const handleSaveDef = useCallback(
    async (name: string, yaml: string, description?: string) => {
      await registerDef(name, yaml, description)
      message.success('工作流已保存')
    },
    [registerDef]
  )

  const handleDeleteDef = useCallback(
    (defId: string) => {
      void deleteDef(defId)
      clearSelection()
    },
    [deleteDef, clearSelection]
  )

  const handleDeleteManagementSession = useCallback(
    (sessionId: string) => {
      const session = managementSessions.find((s) => s.id === sessionId)
      const label = session ? getWorkflowManagementSessionLabel(session) : '该会话'
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除管理会话「${label}」吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          if (!currentScope) return
          await deleteSession(sessionId, currentScope)
          await refreshManagementSessions()
          if (selectedManagementSessionId === sessionId) {
            clearSelection()
          }
        }
      })
    },
    [
      managementSessions,
      currentScope,
      selectedManagementSessionId,
      deleteSession,
      refreshManagementSessions,
      clearSelection
    ]
  )

  /** 为工作流重建管理会话：仅对已绑定 def 的会话有效；删除当前会话并创建新会话（绑定同一工作流），更新 def 引用。
   * 若传入 onDone，在创建成功后以新会话 id 与标签回调（供标签页/定义详情打开新会话）。 */
  const handleRefreshManagementSession = useCallback(
    (sessionId: string, onDone?: (result: { newSessionId: string; label: string }) => void) => {
      const session = managementSessions.find((s) => s.id === sessionId)
      const defId = session?.toolMeta?.workflowDefId ?? session?.bgMeta?.workflowDefId
      if (!defId) {
        message.warning('仅支持为已绑定的工作流重建管理会话')
        return
      }
      const label = session ? getWorkflowManagementSessionLabel(session) : '该工作流的管理会话'
      Modal.confirm({
        title: '重建管理会话',
        content: `确定要为工作流重建管理会话吗？当前对话记录将被清空并重新开始。`,
        okText: '重建',
        cancelText: '取消',
        onOk: async () => {
          if (!currentScope) return
          // 关闭原会话在右侧的 tab，避免重建后仍显示已删除的会话
          closeTab(`wfp:def:${defId}`, makeTabId('session', sessionId))
          await deleteSession(sessionId, currentScope)
          const newId = await createManagementSession(defId)
          await refreshManagementSessions()
          if (defId) await refreshDefs()
          if (newId) {
            const sessions = useWorkflowStore.getState().managementSessions
            const newSession = sessions.find((s) => s.id === newId)
            const newLabel = newSession
              ? getWorkflowManagementSessionLabel(newSession)
              : '工作流会话'
            await onDone?.({ newSessionId: newId, label: newLabel })
          }
          if (selectedManagementSessionId === sessionId) {
            if (newId) {
              selectManagementSession(newId, defId ?? null)
              if (currentScope) await loadSession(newId, currentScope)
            } else {
              clearSelection()
              message.error('重建会话失败')
            }
          }
        }
      })
    },
    [
      managementSessions,
      currentScope,
      selectedManagementSessionId,
      closeTab,
      deleteSession,
      createManagementSession,
      refreshManagementSessions,
      refreshDefs,
      selectManagementSession,
      clearSelection,
      loadSession
    ]
  )

  const handleCancelRun = useCallback((runId: string) => void cancelRun(runId), [cancelRun])
  const handleRerun = useCallback(
    (name: string, args?: Record<string, unknown>) => handleRunWorkflow(name, args),
    [handleRunWorkflow]
  )

  const selectedManagementSession = useMemo(
    () => managementSessions.find((s) => s.id === selectedManagementSessionId),
    [managementSessions, selectedManagementSessionId]
  )

  /** 是否处于「新建工作流」流程（仅选择方式 / 图编辑 / YAML；对话创建直接选中 session 独占主区，不占此流程） */
  const isCreateFlow = createStep !== null

  /** 仅管理会话、未关联任何工作流定义：隐藏右侧标签栏，呈现单会话视图 */
  const isPendingSessionOnly = selectedManagementSessionId != null && selectedDefId == null

  /** 右侧标签栏按「当前条目」隔离：每个定义/运行/总览各自一套标签列表 */
  const tabContextId = useMemo(() => {
    if (selectedDefId) return `wfp:def:${selectedDefId}`
    if (selectedRunId) return `wfp:run:${selectedRunId}`
    return 'wfp:overview'
  }, [selectedDefId, selectedRunId])

  const handleOpenCreate = useCallback(() => {
    setCreateStep('choose')
    clearSelection()
  }, [clearSelection])

  const handleCreateChoice = useCallback(
    async (mode: WorkflowCreateMode) => {
      if (mode === 'session') {
        setCreatingSession(true)
        try {
          const sessionId = await createPendingManagementSession()
          if (sessionId) {
            selectManagementSession(sessionId, null)
            setCreateStep(null)
          } else {
            message.error('创建会话失败')
          }
        } finally {
          setCreatingSession(false)
        }
        return
      }
      setCreateStep(mode)
    },
    [createPendingManagementSession, selectManagementSession]
  )

  const handleCreateCancel = useCallback(() => {
    setCreateStep(null)
  }, [])

  const handleCreateSave = useCallback(
    async (name: string, yaml: string, description?: string) => {
      const created = await registerDef(name, yaml, description)
      if (created) {
        message.success('工作流已创建')
        selectDef(created.id)
        setCreateStep(null)
        const ctxId = `wfp:def:${created.id}`
        const tab = makeEntityTab('workflow-def', created.id, name)
        if (import.meta.env.DEV)
          console.log('[WFP] handleCreateSave open tab', { ctxId, tabId: tab.id })
        openTab(ctxId, tab)
        openRightPanel()
      }
    },
    [registerDef, selectDef, openTab, openRightPanel]
  )

  /** 侧栏「编辑」：选中该定义并在主区直接打开编辑器 Modal（不再打开右侧 Tab） */
  const [openEditorForDefId, setOpenEditorForDefId] = useState<string | null>(null)
  const handleOpenEditorModal = useCallback((defId: string, _label: string) => {
    selectDef(defId)
    setOpenEditorForDefId(defId)
  }, [selectDef])

  /** 在右侧标签页打开管理会话（不切换主区选中） */
  const handleOpenSessionInTab = useCallback(
    (sessionId: string, label: string) => {
      const tab = makeEntityTab('session', sessionId, label)
      if (import.meta.env.DEV) {
        console.log('[WFP] handleOpenSessionInTab', {
          tabContextId,
          sessionId,
          label,
          tabId: tab.id
        })
      }
      openTab(tabContextId, tab)
      openRightPanel()
    },
    [openTab, openRightPanel, tabContextId]
  )

  /** 从标签页「在主区打开」：会话独占主区（清空 def 选中） */
  const handleLoadSessionInMain = useCallback(
    (sessionId: string) => {
      selectManagementSession(sessionId, null)
      closeRightPanel()
    },
    [selectManagementSession, closeRightPanel]
  )

  const handleNewSession = useCallback(async () => {
    const sessionId = await createPendingManagementSession()
    if (sessionId) {
      selectManagementSession(sessionId, null)
    } else {
      message.error('创建会话失败')
    }
  }, [createPendingManagementSession, selectManagementSession])

  /** 选中定义时若带 sessionId，则在右侧打开会话标签（主区仍为定义详情） */
  const handleSelectDef = useCallback(
    (defId: string, sessionId?: string | null) => {
      selectDef(defId, sessionId)
      if (sessionId) {
        const session = managementSessions.find((s) => s.id === sessionId)
        const label = session ? getWorkflowManagementSessionLabel(session) : '工作流会话'
        const tab = makeEntityTab('session', sessionId, label)
        if (import.meta.env.DEV) {
          console.log('[WFP] handleSelectDef open session tab', {
            tabContextId: `wfp:def:${defId}`,
            sessionId,
            tabId: tab.id
          })
        }
        openTab(`wfp:def:${defId}`, tab)
        openRightPanel()
      }
    },
    [selectDef, managementSessions, openTab, openRightPanel]
  )

  const mainContent = (
    <>
      {viewMode === 'overview' && (
        <WorkflowOverview
          defs={defs}
          runs={runs}
          onSelectRun={selectRun}
          onSelectDef={handleSelectDef}
          onNewWorkflow={handleOpenCreate}
          onNewSession={handleNewSession}
          onCancelRun={handleCancelRun}
        />
      )}
      {viewMode === 'def-detail' && selectedDef && (
        <WorkflowDefDetail
          defRecord={selectedDef}
          runs={runs}
          loading={loading}
          activeTab={activeTab}
          onTabChange={setTab}
          onSelectRun={selectRun}
          onCancelRun={handleCancelRun}
          onRefreshRuns={refreshRuns}
          onRunWorkflow={handleRunWorkflow}
          onSaveDef={handleSaveDef}
          onDeleteDef={handleDeleteDef}
          openEditorForDefId={openEditorForDefId}
          onClearOpenEditorRequest={() => setOpenEditorForDefId(null)}
          onOpenManagementSession={async (sessionId) => {
            if (import.meta.env.DEV)
              console.log('[WFP] onOpenManagementSession', {
                sessionId,
                tabContextId,
                currentScope
              })
            if (currentScope) await loadSession(sessionId, currentScope)
            const session = managementSessions.find((s) => s.id === sessionId)
            const label = session ? getWorkflowManagementSessionLabel(session) : '工作流会话'
            if (import.meta.env.DEV)
              console.log('[WFP] onOpenManagementSession after loadSession', { label })
            handleOpenSessionInTab(sessionId, label)
          }}
          onRefreshManagementSession={handleRefreshManagementSession}
        />
      )}
      {viewMode === 'run-detail' && selectedRunId && (
        <WorkflowRunDetailPanel
          runId={selectedRunId}
          defName={selectedDef?.name}
          onGoBack={goBack}
          onRerun={handleRerun}
          onOpenStepSession={handleOpenSessionInTab}
          onOpenRunInManagementSession={async (workflowName, runId, runLabel) => {
            const def = defs.find((d) => d.name === workflowName)
            if (!def) {
              message.error('未找到对应工作流定义')
              return
            }
            const sessionId = await createManagementSession(def.id)
            if (!sessionId) {
              message.error('打开管理会话失败')
              return
            }
            if (currentScope) await loadSession(sessionId, currentScope)
            setPendingInitialRunRef({ runId, label: runLabel })
            selectManagementSession(sessionId, def.id)
            void refreshManagementSessions()
          }}
        />
      )}
    </>
  )

  /** 主区内容：管理会话选中时独占主区（仅一个 session），否则为总览/定义/运行 */
  const mainPaneContent =
    viewMode === 'management-session' && selectedManagementSessionId ? (
      <div className="wfp-session-main">
        <div className="wfp-session-main__header">
          <Button
            type="text"
            size="small"
            icon={<Icon icon={ArrowLeft} size={16} />}
            onClick={goBack}
          />
          <span className="wfp-session-main__title">
            {selectedManagementSession
              ? getWorkflowManagementSessionLabel(selectedManagementSession)
              : '工作流会话'}
          </span>
        </div>
        <div className="wfp-session-main__body">
          <WorkflowChatZone
            sessionId={selectedManagementSessionId}
            session={selectedManagementSession ?? null}
            scope={currentScope!}
            initialRunRef={pendingInitialRunRef}
            onClearInitialRunRef={clearPendingInitialRunRef}
          />
        </div>
      </div>
    ) : (
      mainContent
    )

  if (isCreateFlow) {
    const showCreateChoice = createStep === 'choose'
    const showEditor = createStep === 'graph' || createStep === 'yaml'

    return (
      <div className="wfp-layout">
        <ResizableSidebar
          side="left"
          defaultWidth={300}
          minWidth={220}
          maxWidth={560}
          storageKey="workflow-sidebar"
          className="wfp-sidebar-wrap"
          handleWidth={16}
          handleOverflow={8}
        >
          <WorkflowSidebar
            defs={defs}
            runs={runs}
            managementSessions={managementSessions}
            selectedDefId={selectedDefId}
            selectedManagementSessionId={selectedManagementSessionId}
            searchQuery={pageState.searchQuery}
            onSearch={setSearch}
            onSelectDef={handleSelectDef}
            onSelectManagementSession={selectManagementSession}
            onOpenCreatePanel={handleOpenCreate}
            onNewSession={handleNewSession}
            onRunWorkflow={handleRunWorkflow}
            onDeleteDef={handleDeleteDef}
            onDeleteManagementSession={handleDeleteManagementSession}
            onOpenRightPanel={openRightPanel}
            onOpenDefInTab={handleOpenEditorModal}
          />
        </ResizableSidebar>

        <div className="wfp-main wfp-main__single">
          {showCreateChoice && (
            <WorkflowCreateChoice
              onChoose={handleCreateChoice}
              onCancel={handleCreateCancel}
              creatingSession={creatingSession}
            />
          )}
          {showEditor && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <WorkflowEditor
                onSave={handleCreateSave}
                onRun={(name) => handleRunWorkflow(name)}
                onClose={handleCreateCancel}
                initialYamlMode={createStep === 'yaml'}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="wfp-layout">
      <ResizableSidebar
        side="left"
        defaultWidth={300}
        minWidth={220}
        maxWidth={560}
        storageKey="workflow-sidebar"
        className="wfp-sidebar-wrap"
        handleWidth={16}
        handleOverflow={8}
      >
        <WorkflowSidebar
          defs={defs}
          runs={runs}
          managementSessions={managementSessions}
          selectedDefId={selectedDefId}
          selectedManagementSessionId={selectedManagementSessionId}
          searchQuery={pageState.searchQuery}
          onSearch={setSearch}
          onSelectDef={handleSelectDef}
          onSelectManagementSession={selectManagementSession}
          onOpenCreatePanel={handleOpenCreate}
          onNewSession={handleNewSession}
          onRunWorkflow={handleRunWorkflow}
          onDeleteDef={handleDeleteDef}
            onDeleteManagementSession={handleDeleteManagementSession}
            onOpenRightPanel={openRightPanel}
            onOpenDefInTab={handleOpenEditorModal}
            hideTabBarEntry={isPendingSessionOnly}
          />
      </ResizableSidebar>

      {!isPendingSessionOnly && rightPanelOpen ? (
        <div className="collab-split-container wfp-split-container" ref={splitContainerRef}>
          <div
            className="collab-split-pane wfp-split-pane"
            style={{ width: `calc(${splitPct}% - 4px)` }}
          >
            <div className="wfp-detail-panel">{mainPaneContent}</div>
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
            className="collab-split-pane wfp-split-pane"
            style={{ width: `calc(${100 - splitPct}% - 4px)` }}
          >
            <UnifiedRightPanel
              contextId={tabContextId}
              onClose={closeRightPanel}
              onLoadSession={handleLoadSessionInMain}
              scope={currentScope}
              renderSessionTabContent={(sessionId, scope, session) => (
                <WorkflowChatZone
                  sessionId={sessionId}
                  session={session}
                  scope={scope}
                />
              )}
              className="wfp-right-panel"
            />
          </div>
        </div>
      ) : (
        <div className="wfp-main wfp-main--single">
          <div className="wfp-detail-panel">{mainPaneContent}</div>
        </div>
      )}
    </div>
  )
}
