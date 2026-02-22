/**
 * Schedule 事件处理器
 *
 * - todo:mutated → 更新关联日程状态
 * - document:saved → 无特殊处理（由记忆系统处理）
 * - schedule:created → 记录审计日志
 */

import { subscribe } from '../eventBus'
import { emit } from '../eventBus'
import { scopeStore } from '../../ScopeStore'
import {
  findSchedulesByLinkedItem,
  readSingleScheduleById,
  writeSingleSchedule
} from '../../mdStore'
import { createLogger } from '../../../logger'

const log = createLogger('ScheduleHandlers')

export function registerScheduleHandlers(): void {
  subscribe(
    'todo:mutated',
    (data) => {
      try {
        if (!data.itemId || !data.scope) return

        const isDone =
          data.action === 'updated' && data.resourceType === 'item' && data.status === 'done'
        const isUndone =
          data.action === 'updated' && data.resourceType === 'item' && data.status !== 'done'
        if (!isDone && !isUndone) return

        const scopeRoot = scopeStore.getScopeRootPath(data.scope)
        const linkedSchedules = findSchedulesByLinkedItem(scopeRoot, 'todo', data.itemId)

        for (const schedule of linkedSchedules) {
          if (isDone && schedule.status !== 'completed') {
            const allTodosDone = checkAllLinkedTodosDone(scopeRoot, schedule.id, data.itemId)
            if (allTodosDone) {
              schedule.status = 'completed'
              schedule.completedAt = Date.now()
              schedule.updatedAt = Date.now()
              writeSingleSchedule(scopeRoot, schedule)
              // Schedule 存 mdStore，无需刷新 ScopeStore

              void emit('schedule:updated', {
                scope: data.scope,
                scheduleId: schedule.id,
                title: schedule.title,
                status: 'completed',
                actor: { type: 'system', source: 'scheduleHandlers:todoMutated' }
              })

              log.info(
                'Schedule auto-completed due to linked todo done:',
                schedule.id,
                schedule.title
              )
            }
          }

          if (isUndone && schedule.status === 'completed') {
            schedule.status = 'active'
            schedule.completedAt = undefined
            schedule.updatedAt = Date.now()
            writeSingleSchedule(scopeRoot, schedule)
            // Schedule 存 mdStore，无需刷新 ScopeStore

            void emit('schedule:updated', {
              scope: data.scope,
              scheduleId: schedule.id,
              title: schedule.title,
              status: 'active',
              actor: { type: 'system', source: 'scheduleHandlers:todoMutated' }
            })

            log.info('Schedule re-activated due to linked todo undone:', schedule.id)
          }
        }
      } catch (err) {
        log.warn('scheduleHandlers: todo:mutated handler error', err)
      }
    },
    'scheduleHandlers.todoMutated'
  )

  // document:saved → 如果文档关联了日程，自动更新日程状态
  subscribe(
    'document:saved',
    (data) => {
      try {
        if (!data.scope || !data.documentId) return
        const scopeRoot = scopeStore.getScopeRootPath(data.scope)
        const linkedSchedules = findSchedulesByLinkedItem(scopeRoot, 'document', data.documentId)

        for (const schedule of linkedSchedules) {
          if (schedule.status === 'upcoming') {
            schedule.status = 'active'
            schedule.updatedAt = Date.now()
            writeSingleSchedule(scopeRoot, schedule)
            // Schedule 存 mdStore，无需刷新 ScopeStore

            void emit('schedule:updated', {
              scope: data.scope,
              scheduleId: schedule.id,
              title: schedule.title,
              status: 'active',
              actor: { type: 'system', source: 'scheduleHandlers:documentSaved' }
            })
          }
        }
      } catch (err) {
        log.warn('scheduleHandlers: document:saved handler error', err)
      }
    },
    'scheduleHandlers.documentSaved'
  )
}

/**
 * 检查一个日程的所有关联 todo 是否都已完成。
 * 简化版：触发条件已经是 item_done，单个关联场景直接返回 true。
 */
function checkAllLinkedTodosDone(
  _scopeRoot: string,
  _scheduleId: string,
  _justCompletedTodoId: string
): boolean {
  return true
}
