import { PrizmClient } from '../client'
import type { TaskRun } from '@prizm/shared'

export interface RunTaskPayload {
  prompt: string
  label?: string
  model?: string
  context?: string | Record<string, unknown>
  expected_output?: string
  timeout_seconds?: number
  mode?: 'sync' | 'async'
}

export interface RunTaskResult {
  taskId?: string
  status: string
  // sync mode returns full TaskRun fields
  id?: string
  output?: string
  structuredData?: string
  durationMs?: number
}

declare module '../client' {
  interface PrizmClient {
    runTask(payload: RunTaskPayload, scope?: string): Promise<RunTaskResult>
    listTasks(scope?: string, status?: string): Promise<TaskRun[]>
    getTask(taskId: string): Promise<TaskRun | null>
    cancelTask(taskId: string): Promise<void>
  }
}

PrizmClient.prototype.runTask = async function (
  this: PrizmClient,
  payload: RunTaskPayload,
  scope?: string
) {
  return this.request<RunTaskResult>('/task/run', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope
  })
}

PrizmClient.prototype.listTasks = async function (
  this: PrizmClient,
  scope?: string,
  status?: string
) {
  let path = '/task/list'
  if (status) path += `?status=${encodeURIComponent(status)}`
  return this.request<TaskRun[]>(path, { scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.getTask = async function (
  this: PrizmClient,
  taskId: string
) {
  try {
    return await this.request<TaskRun>(`/task/${taskId}`)
  } catch {
    return null
  }
}

PrizmClient.prototype.cancelTask = async function (
  this: PrizmClient,
  taskId: string
) {
  await this.request(`/task/${taskId}`, { method: 'DELETE' })
}
