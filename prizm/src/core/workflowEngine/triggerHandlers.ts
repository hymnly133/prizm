/**
 * Workflow Trigger Handlers — 跨系统事件触发
 *
 * 订阅 Prizm EventBus 事件，当事件匹配已注册工作流的 trigger 条件时，
 * 自动启动工作流运行。
 */

import { subscribe } from '../eventBus/eventBus'
import { createLogger } from '../../logger'
import * as defStore from './workflowDefStore'
import { parseWorkflowDef } from './parser'
import type { WorkflowTriggerDef } from '@prizm/shared'

const log = createLogger('WorkflowTriggerHandlers')

/**
 * 注册工作流触发事件处理器。
 * 在 server 启动时调用一次。
 */
export function registerWorkflowTriggerHandlers(): void {
  subscribe(
    'schedule:reminded',
    (data) => {
      void triggerMatchingWorkflows(data.scope, 'schedule_remind', {
        scheduleId: data.scheduleId,
        title: data.title
      })
    },
    'workflowTrigger.scheduleReminded'
  )

  subscribe(
    'todo:mutated',
    (data) => {
      if (data.action === 'updated' && data.status === 'done') {
        void triggerMatchingWorkflows(data.scope, 'todo_completed', {
          listId: data.listId,
          itemId: data.itemId ?? ''
        })
      }
    },
    'workflowTrigger.todoCompleted'
  )

  subscribe(
    'document:saved',
    (data) => {
      void triggerMatchingWorkflows(data.scope, 'document_saved', {
        documentId: data.documentId,
        title: data.title
      })
    },
    'workflowTrigger.documentSaved'
  )

  log.info('Workflow trigger handlers registered')
}

async function triggerMatchingWorkflows(
  scope: string,
  triggerType: WorkflowTriggerDef['type'],
  eventData: Record<string, string>
): Promise<void> {
  try {
    const defs = defStore.listDefs(scope)
    for (const defRecord of defs) {
      if (!defRecord.triggersJson) continue

      let triggers: WorkflowTriggerDef[]
      try {
        triggers = JSON.parse(defRecord.triggersJson)
      } catch {
        continue
      }

      for (const trigger of triggers) {
        if (trigger.type !== triggerType) continue
        if (!matchFilter(trigger.filter, eventData)) continue

        log.info(`Auto-triggering workflow "${defRecord.name}" (trigger: ${triggerType})`)

        try {
          const def = parseWorkflowDef(defRecord.yamlContent)
          const { getWorkflowRunner } = await import('./runner')
          const runner = getWorkflowRunner()
          void runner.runWorkflow(scope, def, { triggerType: 'event', args: eventData })
        } catch (err) {
          log.error(`Failed to auto-trigger workflow "${defRecord.name}":`, err)
        }
      }
    }
  } catch (err) {
    log.error('triggerMatchingWorkflows error:', err)
  }
}

function matchFilter(
  filter: Record<string, string> | undefined,
  eventData: Record<string, string>
): boolean {
  if (!filter) return true
  for (const [key, value] of Object.entries(filter)) {
    if (eventData[key] !== value) return false
  }
  return true
}
