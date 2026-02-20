/**
 * workflowStore — 工作流运行状态 + 定义管理
 */
import { create } from 'zustand'
import type {
  PrizmClient,
  WorkflowFileEntry,
  WorkflowFileContent,
  WorkflowRunWorkspaceEntry,
  WorkflowUploadResult,
  WorkflowResolvedPath
} from '@prizm/client-core'
import type { WorkflowRun, WorkflowDefRecord, WorkflowStepResult } from '@prizm/shared'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('WorkflowStore')

export interface WorkflowRunPayload {
  workflow_name?: string
  yaml?: string
  args?: Record<string, unknown>
}

export interface WorkflowStoreState {
  runs: WorkflowRun[]
  defs: WorkflowDefRecord[]
  loading: boolean
  currentScope: string | null

  refreshRuns(): Promise<void>
  refreshDefs(): Promise<void>
  getRunDetail(runId: string): Promise<WorkflowRun | null>
  resumeWorkflow(resumeToken: string, approved: boolean): Promise<void>
  cancelRun(runId: string): Promise<void>
  runWorkflow(payload: WorkflowRunPayload): Promise<{ runId: string } | null>
  registerDef(name: string, yaml: string, description?: string): Promise<WorkflowDefRecord | null>
  /** Alias for registerDef — upserts by name+scope */
  updateDef(name: string, yaml: string, description?: string): Promise<WorkflowDefRecord | null>
  deleteDef(defId: string): Promise<void>

  getWorkspaceFiles(workflowName: string): Promise<WorkflowFileEntry[]>
  getRunWorkspaceFiles(runId: string): Promise<WorkflowFileEntry[]>
  getRunWorkspaces(workflowName: string): Promise<WorkflowRunWorkspaceEntry[]>
  readWorkspaceFile(filePath: string): Promise<WorkflowFileContent | null>
  deleteWorkspaceFile(filePath: string): Promise<void>
  uploadFile(
    targetDir: string,
    fileName: string,
    contentBase64: string
  ): Promise<WorkflowUploadResult | null>
  resolveWorkspacePath(
    workflowName: string,
    type: 'persistent' | 'run',
    runId?: string
  ): Promise<WorkflowResolvedPath | null>

  bind(http: PrizmClient, scope: string): void
  reset(): void
}

let _http: PrizmClient | null = null

export const useWorkflowStore = create<WorkflowStoreState>()((set, get) => ({
  runs: [],
  defs: [],
  loading: false,
  currentScope: null,

  async refreshRuns() {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ loading: true })
    try {
      const runs = await _http.getWorkflowRuns(scope)
      set({ runs })
    } catch (err) {
      log.warn('Refresh workflow runs failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  async refreshDefs() {
    const scope = get().currentScope
    if (!_http || !scope) return
    try {
      const defs = await _http.getWorkflowDefs(scope)
      set({ defs })
    } catch (err) {
      log.warn('Refresh workflow defs failed:', err)
    }
  },

  async getRunDetail(runId: string) {
    if (!_http) return null
    try {
      return await _http.getWorkflowRun(runId)
    } catch {
      return null
    }
  },

  async resumeWorkflow(resumeToken: string, approved: boolean) {
    if (!_http) return
    try {
      await _http.resumeWorkflow(resumeToken, approved)
      void get().refreshRuns()
    } catch (err) {
      log.warn('Resume workflow failed:', err)
    }
  },

  async cancelRun(runId: string) {
    if (!_http) return
    try {
      await _http.cancelWorkflowRun(runId)
      void get().refreshRuns()
    } catch (err) {
      log.warn('Cancel workflow run failed:', err)
    }
  },

  async runWorkflow(payload: WorkflowRunPayload) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const result = await _http.runWorkflow(payload, scope)
      void get().refreshRuns()
      return result ? { runId: result.runId } : null
    } catch (err) {
      log.warn('Run workflow failed:', err)
      return null
    }
  },

  async registerDef(name: string, yaml: string, description?: string) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const def = await _http.registerWorkflowDef(name, yaml, description, scope)
      void get().refreshDefs()
      return def
    } catch (err) {
      log.warn('Register workflow def failed:', err)
      return null
    }
  },

  async updateDef(name: string, yaml: string, description?: string) {
    return get().registerDef(name, yaml, description)
  },

  async deleteDef(defId: string) {
    if (!_http) return
    try {
      await _http.deleteWorkflowDef(defId)
      void get().refreshDefs()
    } catch (err) {
      log.warn('Delete workflow def failed:', err)
    }
  },

  async getWorkspaceFiles(workflowName: string) {
    if (!_http) return []
    try {
      return await _http.getWorkflowWorkspaceFiles(workflowName)
    } catch (err) {
      log.warn('Get workspace files failed:', err)
      return []
    }
  },

  async getRunWorkspaceFiles(runId: string) {
    if (!_http) return []
    try {
      return await _http.getRunWorkspaceFiles(runId)
    } catch (err) {
      log.warn('Get run workspace files failed:', err)
      return []
    }
  },

  async getRunWorkspaces(workflowName: string) {
    if (!_http) return []
    try {
      return await _http.getWorkflowRunWorkspaces(workflowName)
    } catch (err) {
      log.warn('Get run workspaces failed:', err)
      return []
    }
  },

  async readWorkspaceFile(filePath: string) {
    if (!_http) return null
    try {
      return await _http.readWorkflowFile(filePath)
    } catch (err) {
      log.warn('Read workspace file failed:', err)
      return null
    }
  },

  async deleteWorkspaceFile(filePath: string) {
    if (!_http) return
    try {
      await _http.deleteWorkflowFile(filePath)
    } catch (err) {
      log.warn('Delete workspace file failed:', err)
    }
  },

  async uploadFile(targetDir: string, fileName: string, contentBase64: string) {
    if (!_http) return null
    try {
      return await _http.uploadWorkflowFile(targetDir, fileName, contentBase64)
    } catch (err) {
      log.warn('Upload workspace file failed:', err)
      return null
    }
  },

  async resolveWorkspacePath(workflowName: string, type: 'persistent' | 'run', runId?: string) {
    if (!_http) return null
    try {
      return await _http.resolveWorkspacePath(workflowName, type, runId)
    } catch (err) {
      log.warn('Resolve workspace path failed:', err)
      return null
    }
  },

  bind(http: PrizmClient, scope: string) {
    const prev = get().currentScope
    _http = http
    if (prev !== scope) {
      set({ currentScope: scope, runs: [], defs: [] })
      void get().refreshRuns()
      void get().refreshDefs()
    }
  },

  reset() {
    _http = null
    set({ currentScope: null, runs: [], defs: [], loading: false })
  }
}))

// ─── WS 实时更新 ───

const DEBOUNCE_MS = 500
let _subscribed = false
let _batchTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (_batchTimer) clearTimeout(_batchTimer)
  _batchTimer = setTimeout(() => {
    _batchTimer = null
    void useWorkflowStore.getState().refreshRuns()
  }, DEBOUNCE_MS)
}

/** 实时更新单个 step（不等服务端刷新，直接本地 patch） */
function patchStepResult(runId: string, stepId: string, update: Partial<WorkflowStepResult>): void {
  const store = useWorkflowStore.getState()
  const idx = store.runs.findIndex((r) => r.id === runId)
  if (idx < 0) {
    scheduleFlush()
    return
  }

  const run = { ...store.runs[idx] }
  run.stepResults = {
    ...run.stepResults,
    [stepId]: { ...run.stepResults[stepId], stepId, ...update } as WorkflowStepResult
  }
  const newRuns = [...store.runs]
  newRuns[idx] = run
  useWorkflowStore.setState({ runs: newRuns })
}

export function subscribeWorkflowEvents(): () => void {
  if (_subscribed) return () => {}
  _subscribed = true

  const unsub = subscribeSyncEvents((eventType: string, payload?: SyncEventPayload) => {
    const store = useWorkflowStore.getState()
    if (!store.currentScope) return

    const p = (payload ?? {}) as Record<string, unknown>
    if (p.scope && p.scope !== store.currentScope) return

    switch (eventType) {
      case 'workflow:started':
        scheduleFlush()
        break
      case 'workflow:step.completed':
        patchStepResult(p.runId as string, p.stepId as string, {
          status: (p.stepStatus as WorkflowStepResult['status']) ?? 'completed',
          output: p.outputPreview as string | undefined,
          approved: p.approved as boolean | undefined
        })
        scheduleFlush()
        break
      case 'workflow:paused':
      case 'workflow:completed':
      case 'workflow:failed':
        scheduleFlush()
        break
    }
  })

  return () => {
    unsub()
    _subscribed = false
    if (_batchTimer) clearTimeout(_batchTimer)
  }
}
