/**
 * Cron 路由 - 定时任务管理 CRUD
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { ensureStringParam, requireScopeForList, getScopeForCreate } from '../scopeUtils'
import { cronManager } from '../core/cronScheduler'
import type { CreateCronJobInput, UpdateCronJobInput } from '../core/cronScheduler'

const log = createLogger('Cron')

export function createCronRoutes(router: Router): void {
  // GET /cron/jobs — 列出定时任务
  router.get('/cron/jobs', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return

      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const jobs = cronManager.listJobs(scope, status)
      res.json(jobs)
    } catch (err) {
      log.error('GET /cron/jobs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // POST /cron/jobs — 创建定时任务
  router.post('/cron/jobs', (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const body = req.body as Partial<CreateCronJobInput>

      if (!body.name || !body.schedule || !body.taskPrompt) {
        res.status(400).json({ error: 'name, schedule, and taskPrompt are required' })
        return
      }

      const input: CreateCronJobInput = {
        name: body.name,
        description: body.description,
        scope,
        schedule: body.schedule,
        timezone: body.timezone,
        taskPrompt: body.taskPrompt,
        taskContext: body.taskContext,
        executionMode: body.executionMode,
        model: body.model,
        timeoutMs: body.timeoutMs,
        maxRetries: body.maxRetries,
        linkedScheduleId: body.linkedScheduleId
      }

      const job = cronManager.createJob(input)
      res.status(201).json(job)
    } catch (err) {
      log.error('POST /cron/jobs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // PATCH /cron/jobs/:id — 更新定时任务
  router.patch('/cron/jobs/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const body = req.body as UpdateCronJobInput

      const job = cronManager.updateJob(id, body)
      if (!job) {
        res.status(404).json({ error: 'Cron job not found' })
        return
      }
      res.json(job)
    } catch (err) {
      log.error('PATCH /cron/jobs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // DELETE /cron/jobs/:id — 删除定时任务
  router.delete('/cron/jobs/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const deleted = cronManager.deleteJob(id)
      if (!deleted) {
        res.status(404).json({ error: 'Cron job not found' })
        return
      }
      res.json({ success: true })
    } catch (err) {
      log.error('DELETE /cron/jobs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // POST /cron/jobs/:id/pause — 暂停
  router.post('/cron/jobs/:id/pause', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const job = cronManager.pauseJob(id)
      if (!job) {
        res.status(404).json({ error: 'Cron job not found or not active' })
        return
      }
      res.json(job)
    } catch (err) {
      log.error('POST /cron/jobs/:id/pause error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // POST /cron/jobs/:id/resume — 恢复
  router.post('/cron/jobs/:id/resume', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const job = cronManager.resumeJob(id)
      if (!job) {
        res.status(404).json({ error: 'Cron job not found or not paused' })
        return
      }
      res.json(job)
    } catch (err) {
      log.error('POST /cron/jobs/:id/resume error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // POST /cron/jobs/:id/trigger — 手动触发一次
  router.post('/cron/jobs/:id/trigger', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const sessionId = await cronManager.triggerManually(id)
      if (sessionId == null) {
        res.status(404).json({ error: 'Cron job not found' })
        return
      }
      res.json({ sessionId })
    } catch (err) {
      log.error('POST /cron/jobs/:id/trigger error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // GET /cron/jobs/:id/logs — 执行日志
  router.get('/cron/jobs/:id/logs', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const limit = req.query.limit ? Number(req.query.limit) : 50
      const offset = req.query.offset ? Number(req.query.offset) : 0

      const logs = cronManager.getRunLogs({ jobId: id, limit, offset })
      res.json(logs)
    } catch (err) {
      log.error('GET /cron/jobs/:id/logs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })
}
