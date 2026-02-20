/**
 * Workflow Engine — barrel exports
 */

export type {
  IStepExecutor,
  StepExecutionInput,
  StepExecutionOutput,
  WorkflowRunResult,
  RunWorkflowOptions
} from './types'

export { BgSessionStepExecutor } from './bgSessionStepExecutor'
export { WorkflowRunner, initWorkflowRunner, getWorkflowRunner } from './runner'
export { TaskRunner, initTaskRunner, getTaskRunner, shutdownTaskRunner } from './taskRunner'
export type { TaskTriggerInput, TaskMeta } from './taskRunner'
export { parseWorkflowDef, serializeWorkflowDef, WorkflowParseError } from './parser'
export { executeLinkedActions } from './linkedActionExecutor'
export { registerWorkflowTriggerHandlers } from './triggerHandlers'
export { writeRunMeta, readRunMeta, listRecentRuns } from './runMetaWriter'
export type { RunMetaData, RunMetaSummary } from './runMetaWriter'

// 工作流定义 — 文件系统存储
export {
  registerDef,
  getDefById,
  getDefByName,
  listDefs,
  deleteDef
} from './workflowDefStore'

// 运行记录 + 任务记录 — SQLite 存储
export {
  initResumeStore,
  closeResumeStore,
  createRun,
  getRunById,
  listRuns,
  updateRunStatus,
  updateRunStep,
  getRunByResumeToken,
  deleteRun,
  pruneRuns,
  readLegacyDefs,
  dropLegacyDefTable,
  createTaskRun,
  getTaskRun,
  listTaskRuns,
  updateTaskRun,
  deleteTaskRun,
  pruneTaskRuns,
  recoverStaleTaskRuns,
  recoverStaleWorkflowRuns,
  recoverStaleTaskRunsByAge,
  recoverStaleWorkflowRunsByAge
} from './resumeStore'
