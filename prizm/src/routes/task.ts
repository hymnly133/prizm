/**
 * Task 路由 — 单步任务执行 REST API
 *
 * Task 是 Workflow 子模块级复用组件，通过 TaskRunner 执行。
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { requireScopeForList, getScopeForCreate } from '../scopeUtils'
import { getTaskRunner } from '../core/workflowEngine'
import type { TaskRunStatus } from '@prizm/shared'

const log = createLogger('TaskRoute')

export function createTaskRoutes(router: Router): void {
  router.post('/task/run', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const {
        prompt,
        label,
        model,
        context,
        expected_output,
        timeout_seconds,
        mode
      } = req.body

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required' })
      }

      let parsedContext: Record<string, unknown> | undefined
      if (context) {
        if (typeof context === 'string') {
          try { parsedContext = JSON.parse(context) } catch {
            return res.status(400).json({ error: 'context must be valid JSON' })
          }
        } else if (typeof context === 'object') {
          parsedContext = context
        }
      }

      const taskRunner = getTaskRunner()
      const input = {
        prompt,
        label,
        model,
        context: parsedContext,
        expectedOutputFormat: expected_output,
        timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined
      }

      if (mode === 'sync') {
        const taskRun = await taskRunner.triggerSync(scope, input, { triggerType: 'manual' })
        res.json(taskRun)
      } else {
        const { taskId } = await taskRunner.trigger(scope, input, { triggerType: 'manual' })
        res.status(202).json({ taskId, status: 'running' })
      }
    } catch (err) {
      log.error('POST /task/run error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/task/list', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const rawStatus = req.query.status
      const status = typeof rawStatus === 'string' ? rawStatus as TaskRunStatus : undefined
      const taskRunner = getTaskRunner()
      const tasks = taskRunner.list(scope, { status })
      res.json(tasks)
    } catch (err) {
      log.error('GET /task/list error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/task/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id)
      const taskRunner = getTaskRunner()
      const task = taskRunner.getStatus(id)
      if (!task) return res.status(404).json({ error: 'Task not found' })
      res.json(task)
    } catch (err) {
      log.error('GET /task/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/task/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id)
      const taskRunner = getTaskRunner()
      const cancelled = await taskRunner.cancel(id)
      if (cancelled) {
        return res.json({ cancelled: true })
      }
      const { deleteTaskRun } = await import('../core/workflowEngine/resumeStore')
      const deleted = deleteTaskRun(id)
      if (!deleted) return res.status(404).json({ error: 'Task not found' })
      res.json({ deleted: true })
    } catch (err) {
      log.error('DELETE /task/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })
}
