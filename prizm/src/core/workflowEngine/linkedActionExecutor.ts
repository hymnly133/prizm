/**
 * LinkedActionExecutor — 步骤联动操作执行器
 *
 * 在工作流步骤完成后执行声明式联动操作，
 * 将工作流与 Prizm 的 Todo/文档/日程/通知系统打通。
 */

import type { WorkflowLinkedAction, WorkflowStepResult } from '@prizm/shared'
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import { emit } from '../eventBus/eventBus'
import {
  writeSingleTodoList,
  readSingleTodoListById,
  writeSingleDocument,
  readSingleScheduleById,
  writeSingleSchedule
} from '../mdStore'
import { scopeStore } from '../ScopeStore'
import type { TodoList, Document, ScheduleItem } from '@prizm/shared'

const log = createLogger('LinkedActionExecutor')

/** 解析 $stepId.output 等变量引用 */
function resolveVars(
  template: string,
  stepResults: Record<string, WorkflowStepResult>,
  args?: Record<string, unknown>
): string {
  return template.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)/g, (_m, stepId, prop) => {
    if (stepId === 'args' && args) {
      return String(args[prop] ?? '')
    }
    const result = stepResults[stepId]
    if (!result) return ''
    if (prop === 'output') return result.output ?? ''
    if (prop === 'approved') return String(result.approved ?? '')
    if (prop === 'sessionId') return result.sessionId ?? ''
    return ''
  })
}

function resolveAllParams(
  params: Record<string, string>,
  stepResults: Record<string, WorkflowStepResult>,
  args?: Record<string, unknown>
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, val] of Object.entries(params)) {
    resolved[key] = resolveVars(val, stepResults, args)
  }
  return resolved
}

export async function executeLinkedActions(
  scope: string,
  actions: WorkflowLinkedAction[],
  stepResults: Record<string, WorkflowStepResult>,
  args?: Record<string, unknown>
): Promise<void> {
  const scopeRoot = scopeStore.getScopeRootPath(scope)

  for (const action of actions) {
    try {
      const params = resolveAllParams(action.params, stepResults, args)
      switch (action.type) {
        case 'create_todo':
          await executeCreateTodo(scopeRoot, scope, params)
          break
        case 'update_todo':
          await executeUpdateTodo(scopeRoot, scope, params)
          break
        case 'create_document':
          await executeCreateDocument(scopeRoot, scope, params)
          break
        case 'update_schedule':
          await executeUpdateSchedule(scopeRoot, scope, params)
          break
        case 'notify':
          await executeNotify(scope, params)
          break
        default:
          log.warn('Unknown linked action type:', action.type)
      }
    } catch (err) {
      log.error('Linked action failed:', action.type, err)
    }
  }
}

async function executeCreateTodo(
  scopeRoot: string,
  scope: string,
  params: Record<string, string>
): Promise<void> {
  const now = Date.now()
  const list: TodoList = {
    id: genUniqueId(),
    name: params.name || '工作流生成待办',
    items: [{
      id: genUniqueId(),
      title: params.title || params.name || '待办事项',
      description: params.description,
      status: 'todo',
      createdAt: now,
      updatedAt: now
    }],
    createdAt: now,
    updatedAt: now
  }
  writeSingleTodoList(scopeRoot, list)
  void emit('todo:mutated', {
    action: 'created',
    scope,
    resourceType: 'list',
    listId: list.id,
    actor: { type: 'system', source: 'workflow:linked_action' }
  })
}

async function executeUpdateTodo(
  scopeRoot: string,
  scope: string,
  params: Record<string, string>
): Promise<void> {
  const { listId, itemId, status } = params
  if (!listId) return

  const list = readSingleTodoListById(scopeRoot, listId)
  if (!list) return

  if (itemId && status) {
    const item = list.items.find((i) => i.id === itemId)
    if (item) {
      item.status = status as 'todo' | 'doing' | 'done'
      item.updatedAt = Date.now()
      list.updatedAt = Date.now()
      writeSingleTodoList(scopeRoot, list)
      void emit('todo:mutated', {
        action: 'updated',
        scope,
        resourceType: 'item',
        listId,
        itemId,
        status,
        actor: { type: 'system', source: 'workflow:linked_action' }
      })
    }
  }
}

async function executeCreateDocument(
  scopeRoot: string,
  scope: string,
  params: Record<string, string>
): Promise<void> {
  const now = Date.now()
  const doc: Document = {
    id: genUniqueId(),
    title: params.title || '工作流生成文档',
    content: params.content || '',
    tags: params.tags ? params.tags.split(',').map((t) => t.trim()) : [],
    createdAt: now,
    updatedAt: now
  }
  writeSingleDocument(scopeRoot, doc)
  void emit('document:saved', {
    scope,
    documentId: doc.id,
    title: doc.title,
    content: doc.content,
    actor: { type: 'system', source: 'workflow:linked_action' }
  })
}

async function executeUpdateSchedule(
  scopeRoot: string,
  scope: string,
  params: Record<string, string>
): Promise<void> {
  const { scheduleId, status } = params
  if (!scheduleId) return

  const item = readSingleScheduleById(scopeRoot, scheduleId)
  if (!item) return

  const validStatuses = ['active', 'completed', 'cancelled'] as const
  if (status && validStatuses.includes(status as ScheduleItem['status'])) {
    item.status = status as ScheduleItem['status']
    if (status === 'completed') item.completedAt = Date.now()
    item.updatedAt = Date.now()
    writeSingleSchedule(scopeRoot, item)
    void emit('schedule:updated', {
      scope,
      scheduleId,
      status,
      actor: { type: 'system', source: 'workflow:linked_action' }
    })
  }
}

async function executeNotify(
  scope: string,
  params: Record<string, string>
): Promise<void> {
  const { title, body } = params
  if (!title) return
  log.info('Workflow notification:', title, body || '(no body)')
  void emit('notification:requested', {
    scope,
    title,
    body: body || undefined,
    source: 'workflow:linked_action'
  } as never)
}
