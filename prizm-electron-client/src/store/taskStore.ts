/**
 * taskStore — 单步任务状态管理
 *
 * 数据来源: /task/* REST API + task:* WS 事件实时更新
 */
import { create } from 'zustand'
import type { PrizmClient } from '@prizm/client-core'
import type { TaskRun, TaskRunStatus } from '@prizm/shared'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('TaskStore')

export interface RunTaskPayload {
  prompt: string
  label?: string
  model?: string
  context?: string | Record<string, unknown>
  expected_output?: string
  timeout_seconds?: number
  mode?: 'sync' | 'async'
}

export interface TaskStoreState {
  tasks: TaskRun[]
  loading: boolean
  currentScope: string | null

  refreshTasks(status?: TaskRunStatus): Promise<void>
  runTask(payload: RunTaskPayload): Promise<TaskRun | null>
  getTaskDetail(taskId: string): Promise<TaskRun | null>
  cancelTask(taskId: string): Promise<void>
  bind(http: PrizmClient, scope: string): void
  reset(): void
}

let _http: PrizmClient | null = null

export const useTaskStore = create<TaskStoreState>()((set, get) => ({
  tasks: [],
  loading: false,
  currentScope: null,

  async refreshTasks(status?: TaskRunStatus) {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ loading: true })
    try {
      const tasks = await _http.listTasks(scope, status)
      set({ tasks })
    } catch (err) {
      log.warn('Refresh tasks failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  async runTask(payload: RunTaskPayload) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const result = await _http.runTask(payload, scope)
      void get().refreshTasks()
      if (result && 'id' in result) {
        return result as unknown as TaskRun
      }
      return null
    } catch (err) {
      log.warn('Run task failed:', err)
      return null
    }
  },

  async getTaskDetail(taskId: string) {
    if (!_http) return null
    try {
      return await _http.getTask(taskId)
    } catch {
      return null
    }
  },

  async cancelTask(taskId: string) {
    if (!_http) return
    try {
      await _http.cancelTask(taskId)
      void get().refreshTasks()
    } catch (err) {
      log.warn('Cancel task failed:', err)
    }
  },

  bind(http: PrizmClient, scope: string) {
    const prev = get().currentScope
    _http = http
    if (prev !== scope) {
      set({ currentScope: scope, tasks: [] })
      void get().refreshTasks()
    }
  },

  reset() {
    _http = null
    set({ currentScope: null, tasks: [], loading: false })
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
    void useTaskStore.getState().refreshTasks()
  }, DEBOUNCE_MS)
}

export function subscribeTaskEvents(): () => void {
  if (_subscribed) return () => {}
  _subscribed = true

  const unsub = subscribeSyncEvents((eventType: string, payload?: SyncEventPayload) => {
    const store = useTaskStore.getState()
    if (!store.currentScope) return

    const p = (payload ?? {}) as Record<string, unknown>
    if (p.scope && p.scope !== store.currentScope) return

    switch (eventType) {
      case 'task:started':
      case 'task:completed':
      case 'task:failed':
      case 'task:cancelled':
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
