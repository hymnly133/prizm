/**
 * WorkflowPage — 工作流独立页面
 *
 * 三栏布局：ResizableSidebar（定义列表）+ 主内容区（根据选中状态显示总览/定义详情/运行详情）
 * 数据全部来自 workflowStore（Zustand），WebSocket 实时更新。
 */

import { useEffect, useCallback, useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import type { WorkflowDefRecord } from '@prizm/shared'
import { usePrizmContext } from '../context/PrizmContext'
import { useScope } from '../hooks/useScope'
import { useWorkflowPageState } from '../hooks/useWorkflowPageState'
import { useWorkflowStore, subscribeWorkflowEvents } from '../store/workflowStore'
import { ResizableSidebar } from '../components/layout'
import { WorkflowSidebar } from '../components/workflow/WorkflowSidebar'
import { WorkflowOverview } from '../components/workflow/WorkflowOverview'
import { WorkflowDefDetail } from '../components/workflow/WorkflowDefDetail'
import { WorkflowRunDetailPanel } from '../components/workflow/WorkflowRunDetailPanel'
import { WorkflowEditor } from '../components/workflow/editor'

export default function WorkflowPage() {
  const { manager } = usePrizmContext()
  const { currentScope } = useScope()

  const bind = useWorkflowStore((s) => s.bind)
  const runs = useWorkflowStore((s) => s.runs)
  const defs = useWorkflowStore((s) => s.defs)
  const loading = useWorkflowStore((s) => s.loading)
  const refreshRuns = useWorkflowStore((s) => s.refreshRuns)
  const refreshDefs = useWorkflowStore((s) => s.refreshDefs)
  const runWorkflow = useWorkflowStore((s) => s.runWorkflow)
  const cancelRun = useWorkflowStore((s) => s.cancelRun)
  const registerDef = useWorkflowStore((s) => s.registerDef)
  const deleteDef = useWorkflowStore((s) => s.deleteDef)

  const pageState = useWorkflowPageState()
  const {
    selectedDefId,
    selectedRunId,
    activeTab,
    searchQuery,
    viewMode,
    selectDef,
    selectRun,
    goBack,
    setTab,
    setSearch,
    clearSelection
  } = pageState

  const [showNewEditor, setShowNewEditor] = useState(false)

  // Bind store to HTTP client + scope
  useEffect(() => {
    if (!manager || !currentScope) return
    const http = manager.getHttpClient()
    bind(http, currentScope)
  }, [manager, currentScope, bind])

  // Subscribe to WS events
  useEffect(() => {
    const unsub = subscribeWorkflowEvents()
    return () => unsub()
  }, [])

  // Current selected def
  const selectedDef = useMemo<WorkflowDefRecord | undefined>(
    () => defs.find((d) => d.id === selectedDefId),
    [defs, selectedDefId]
  )

  // When selected def is deleted externally, clear selection
  useEffect(() => {
    if (selectedDefId && !selectedDef) clearSelection()
  }, [selectedDefId, selectedDef, clearSelection])

  // ─── Actions ───

  const handleRunWorkflow = useCallback(
    (name: string, args?: Record<string, unknown>) => {
      void runWorkflow({ workflow_name: name, args }).then((result) => {
        if (result) {
          message.success(`工作流已启动`)
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

  const handleCancelRun = useCallback((runId: string) => void cancelRun(runId), [cancelRun])

  const handleNewWorkflow = useCallback(() => setShowNewEditor(true), [])

  const handleNewEditorSave = useCallback(
    async (name: string, yaml: string, description?: string) => {
      await registerDef(name, yaml, description)
      setShowNewEditor(false)
      message.success('工作流已创建')
    },
    [registerDef]
  )

  const handleRerun = useCallback(
    (name: string, args?: Record<string, unknown>) => {
      handleRunWorkflow(name, args)
    },
    [handleRunWorkflow]
  )

  return (
    <div className="wfp-layout">
      <ResizableSidebar
        side="left"
        defaultWidth={240}
        minWidth={180}
        maxWidth={400}
        storageKey="workflow-sidebar"
      >
        <WorkflowSidebar
          defs={defs}
          runs={runs}
          selectedDefId={selectedDefId}
          searchQuery={searchQuery}
          onSearch={setSearch}
          onSelectDef={selectDef}
          onNewWorkflow={handleNewWorkflow}
          onRunWorkflow={handleRunWorkflow}
          onDeleteDef={handleDeleteDef}
        />
      </ResizableSidebar>

      <div className="wfp-main">
        {viewMode === 'overview' && (
          <WorkflowOverview
            defs={defs}
            runs={runs}
            onSelectRun={selectRun}
            onSelectDef={selectDef}
            onNewWorkflow={handleNewWorkflow}
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
          />
        )}

        {viewMode === 'run-detail' && selectedRunId && (
          <WorkflowRunDetailPanel
            runId={selectedRunId}
            defName={selectedDef?.name}
            onGoBack={goBack}
            onRerun={handleRerun}
          />
        )}
      </div>

      {/* New workflow editor modal */}
      <Modal
        open={showNewEditor}
        onCancel={() => setShowNewEditor(false)}
        footer={null}
        width="90vw"
        className="wfe-modal"
        destroyOnClose
      >
        <WorkflowEditor
          onSave={handleNewEditorSave}
          onRun={(name) => handleRunWorkflow(name)}
          onClose={() => setShowNewEditor(false)}
        />
      </Modal>
    </div>
  )
}
