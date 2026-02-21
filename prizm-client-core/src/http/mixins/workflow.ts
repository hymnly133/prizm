import { PrizmClient } from '../client'
import type { WorkflowRun, WorkflowDefRecord, WorkflowDefVersionItem } from '@prizm/shared'

export interface WorkflowRunResult {
  runId: string
  status: string
  finalOutput?: string
  resumeToken?: string
  approvePrompt?: string
  error?: string
}

export interface WorkflowFileEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

export interface WorkflowFileContent {
  path: string
  size: number
  content: string
}

export interface WorkflowRunWorkspaceEntry {
  runId: string
  files: WorkflowFileEntry[]
}

export interface WorkflowUploadResult {
  ok: boolean
  path: string
  size: number
}

export interface WorkflowResolvedPath {
  absolutePath: string
  relativePath: string
}

/** 完整 run 记录（GET /workflow/runs/:id/full）：run + meta 文件内容 + 工作区路径 */
export interface WorkflowRunFullResponse {
  run: WorkflowRun
  runMetaMarkdown: string | null
  paths: {
    workflowWorkspace: string
    runWorkspace: string
    stepSessionWorkspaces: { stepId: string; sessionId: string; workspacePath: string }[]
  }
}

declare module '../client' {
  interface PrizmClient {
    getWorkflowDefs(scope?: string): Promise<WorkflowDefRecord[]>
    registerWorkflowDef(
      name: string,
      yaml: string,
      description?: string,
      scope?: string
    ): Promise<WorkflowDefRecord>
    getWorkflowDef(defId: string): Promise<WorkflowDefRecord | null>
    deleteWorkflowDef(defId: string): Promise<void>
    /** 流水线版本列表（无记忆功能） */
    getWorkflowDefVersions(defId: string): Promise<WorkflowDefVersionItem[]>
    /** 指定版本 YAML 内容 */
    getWorkflowDefVersionContent(
      defId: string,
      versionId: string
    ): Promise<{ id: string; yamlContent: string } | null>
    /** 一键回溯到指定版本 */
    rollbackWorkflowDef(defId: string, versionId: string): Promise<WorkflowDefRecord>
    /** 仅创建「待创建」工作流管理会话（不调 LLM），返回 sessionId */
    createPendingWorkflowManagementSession(
      initialPrompt?: string,
      scope?: string
    ): Promise<{ sessionId: string }>
    /** 为已有工作流新建工作流管理会话（幂等），返回 sessionId */
    createWorkflowManagementSession(defId: string, scope?: string): Promise<{ sessionId: string }>
    runWorkflow(
      payload: { workflow_name?: string; yaml?: string; args?: Record<string, unknown> },
      scope?: string
    ): Promise<WorkflowRunResult>
    resumeWorkflow(resumeToken: string, approved?: boolean): Promise<WorkflowRunResult>
    getWorkflowRuns(scope?: string, status?: string): Promise<WorkflowRun[]>
    getWorkflowRun(runId: string): Promise<WorkflowRun | null>
    getWorkflowRunFull(runId: string): Promise<WorkflowRunFullResponse | null>
    cancelWorkflowRun(runId: string): Promise<void>

    getWorkflowWorkspaceFiles(name: string, scope?: string): Promise<WorkflowFileEntry[]>
    getRunWorkspaceFiles(runId: string): Promise<WorkflowFileEntry[]>
    getWorkflowRunWorkspaces(name: string, scope?: string): Promise<WorkflowRunWorkspaceEntry[]>
    readWorkflowFile(filePath: string, scope?: string): Promise<WorkflowFileContent>
    deleteWorkflowFile(filePath: string, scope?: string): Promise<void>
    uploadWorkflowFile(
      targetDir: string,
      fileName: string,
      contentBase64: string,
      scope?: string
    ): Promise<WorkflowUploadResult>
    resolveWorkspacePath(
      workflowName: string,
      type: 'persistent' | 'run',
      runId?: string,
      scope?: string
    ): Promise<WorkflowResolvedPath>
  }
}

PrizmClient.prototype.getWorkflowDefs = async function (this: PrizmClient, scope?: string) {
  return this.request<WorkflowDefRecord[]>('/workflow/defs', { scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.registerWorkflowDef = async function (
  this: PrizmClient,
  name: string,
  yaml: string,
  description?: string,
  scope?: string
) {
  return this.request<WorkflowDefRecord>('/workflow/defs', {
    method: 'POST',
    body: JSON.stringify({ name, yaml, description }),
    scope
  })
}

PrizmClient.prototype.getWorkflowDef = async function (this: PrizmClient, defId: string) {
  try {
    return await this.request<WorkflowDefRecord>(`/workflow/defs/${defId}`)
  } catch {
    return null
  }
}

PrizmClient.prototype.deleteWorkflowDef = async function (this: PrizmClient, defId: string) {
  await this.request(`/workflow/defs/${defId}`, { method: 'DELETE' })
}

PrizmClient.prototype.getWorkflowDefVersions = async function (this: PrizmClient, defId: string) {
  return this.request<WorkflowDefVersionItem[]>(
    `/workflow/defs/${encodeURIComponent(defId)}/versions`
  )
}

PrizmClient.prototype.getWorkflowDefVersionContent = async function (
  this: PrizmClient,
  defId: string,
  versionId: string
) {
  try {
    return await this.request<{ id: string; yamlContent: string }>(
      `/workflow/defs/${encodeURIComponent(defId)}/versions/${encodeURIComponent(versionId)}`
    )
  } catch {
    return null
  }
}

PrizmClient.prototype.rollbackWorkflowDef = async function (
  this: PrizmClient,
  defId: string,
  versionId: string
) {
  return this.request<WorkflowDefRecord>(`/workflow/defs/${encodeURIComponent(defId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ versionId })
  })
}

PrizmClient.prototype.createPendingWorkflowManagementSession = async function (
  this: PrizmClient,
  initialPrompt?: string,
  scope?: string
) {
  return this.request<{ sessionId: string }>('/workflow/management-session', {
    method: 'POST',
    body: initialPrompt != null ? JSON.stringify({ initialPrompt }) : undefined,
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.createWorkflowManagementSession = async function (
  this: PrizmClient,
  defId: string,
  scope?: string
) {
  return this.request<{ sessionId: string }>(
    `/workflow/defs/${encodeURIComponent(defId)}/management-session`,
    { method: 'POST', scope }
  )
}

PrizmClient.prototype.runWorkflow = async function (
  this: PrizmClient,
  payload: { workflow_name?: string; yaml?: string; args?: Record<string, unknown> },
  scope?: string
) {
  return this.request<WorkflowRunResult>('/workflow/run', {
    method: 'POST',
    body: JSON.stringify(payload),
    scope
  })
}

PrizmClient.prototype.resumeWorkflow = async function (
  this: PrizmClient,
  resumeToken: string,
  approved = true
) {
  return this.request<WorkflowRunResult>('/workflow/resume', {
    method: 'POST',
    body: JSON.stringify({ resume_token: resumeToken, approved })
  })
}

PrizmClient.prototype.getWorkflowRuns = async function (
  this: PrizmClient,
  scope?: string,
  status?: string
) {
  let path = '/workflow/runs'
  if (status) path += `?status=${encodeURIComponent(status)}`
  return this.request<WorkflowRun[]>(path, { scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.getWorkflowRun = async function (this: PrizmClient, runId: string) {
  try {
    return await this.request<WorkflowRun>(`/workflow/runs/${runId}`)
  } catch {
    return null
  }
}

PrizmClient.prototype.getWorkflowRunFull = async function (this: PrizmClient, runId: string) {
  try {
    return await this.request<WorkflowRunFullResponse>(`/workflow/runs/${runId}/full`)
  } catch {
    return null
  }
}

PrizmClient.prototype.cancelWorkflowRun = async function (this: PrizmClient, runId: string) {
  await this.request(`/workflow/runs/${runId}`, { method: 'DELETE' })
}

PrizmClient.prototype.getWorkflowWorkspaceFiles = async function (
  this: PrizmClient,
  name: string,
  scope?: string
) {
  return this.request<WorkflowFileEntry[]>(`/workflow/defs/${encodeURIComponent(name)}/workspace`, {
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.getRunWorkspaceFiles = async function (this: PrizmClient, runId: string) {
  return this.request<WorkflowFileEntry[]>(`/workflow/runs/${runId}/workspace`)
}

PrizmClient.prototype.getWorkflowRunWorkspaces = async function (
  this: PrizmClient,
  name: string,
  scope?: string
) {
  return this.request<WorkflowRunWorkspaceEntry[]>(
    `/workflow/defs/${encodeURIComponent(name)}/workspace/runs`,
    { scope: scope ?? this.defaultScope }
  )
}

PrizmClient.prototype.readWorkflowFile = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  return this.request<WorkflowFileContent>(
    `/workflow/workspace/file?path=${encodeURIComponent(filePath)}`,
    { scope: scope ?? this.defaultScope }
  )
}

PrizmClient.prototype.deleteWorkflowFile = async function (
  this: PrizmClient,
  filePath: string,
  scope?: string
) {
  await this.request(`/workflow/workspace/file?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.uploadWorkflowFile = async function (
  this: PrizmClient,
  targetDir: string,
  fileName: string,
  contentBase64: string,
  scope?: string
) {
  return this.request<WorkflowUploadResult>('/workflow/workspace/upload', {
    method: 'POST',
    body: JSON.stringify({ targetDir, fileName, contentBase64 }),
    scope: scope ?? this.defaultScope
  })
}

PrizmClient.prototype.resolveWorkspacePath = async function (
  this: PrizmClient,
  workflowName: string,
  type: 'persistent' | 'run',
  runId?: string,
  scope?: string
) {
  return this.request<WorkflowResolvedPath>('/workflow/workspace/resolve-path', {
    method: 'POST',
    body: JSON.stringify({ workflowName, type, runId }),
    scope: scope ?? this.defaultScope
  })
}
