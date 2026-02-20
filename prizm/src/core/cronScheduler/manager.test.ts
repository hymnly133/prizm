/**
 * CronManager 单元测试
 *
 * mock cronStore 和 bgManager，验证 job 生命周期、once: 恢复策略、并发限制。
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('node-cron', () => {
  const tasks = new Map<string, { stop: Mock }>()
  return {
    default: {
      validate: vi.fn(() => true),
      schedule: vi.fn((_expr: string, cb: () => void) => {
        const task = { stop: vi.fn() }
        tasks.set(_expr, task)
        ;(task as Record<string, unknown>).__cb = cb
        return task
      })
    },
    __tasks: tasks
  }
})

vi.mock('./cronStore', () => {
  const jobs = new Map<string, Record<string, unknown>>()
  let idCounter = 0
  return {
    initCronStore: vi.fn(),
    closeCronStore: vi.fn(),
    listActiveJobs: vi.fn(() => [...jobs.values()].filter((j) => j.status === 'active')),
    createJob: vi.fn((input: Record<string, unknown>) => {
      const id = `cron-${++idCounter}`
      const now = Date.now()
      const job = {
        id,
        name: input.name,
        description: input.description,
        scope: input.scope,
        schedule: input.schedule,
        timezone: input.timezone,
        taskPrompt: input.taskPrompt,
        taskContext: input.taskContext,
        executionMode: input.executionMode ?? 'isolated',
        model: input.model,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries ?? 0,
        linkedScheduleId: input.linkedScheduleId,
        status: 'active' as const,
        runCount: 0,
        createdAt: now,
        updatedAt: now
      }
      jobs.set(id, job)
      return { ...job }
    }),
    getJobById: vi.fn((id: string) => {
      const j = jobs.get(id)
      return j ? { ...j } : null
    }),
    updateJob: vi.fn((id: string, input: Record<string, unknown>) => {
      const j = jobs.get(id)
      if (!j) return null
      Object.assign(j, input, { updatedAt: Date.now() })
      return { ...j }
    }),
    setJobStatus: vi.fn((id: string, status: string) => {
      const j = jobs.get(id)
      if (j) j.status = status
    }),
    deleteJob: vi.fn((id: string) => jobs.delete(id)),
    listJobs: vi.fn((scope?: string, status?: string) => {
      return [...jobs.values()].filter(
        (j) => (!scope || j.scope === scope) && (!status || j.status === status)
      )
    }),
    recordJobRun: vi.fn(),
    insertRunLog: vi.fn(() => 'log-1'),
    completeRunLog: vi.fn(),
    getRunLogs: vi.fn(() => []),
    pruneRunLogs: vi.fn(() => 0),
    __jobs: jobs
  }
})

import { CronManager } from './manager'
import * as cronStore from './cronStore'
import type { BackgroundSessionManager } from '../backgroundSession/manager'

function createMockBgManager(): BackgroundSessionManager {
  return {
    trigger: vi.fn().mockResolvedValue({ sessionId: 'bg-sess-1' }),
    init: vi.fn(),
    shutdown: vi.fn()
  } as unknown as BackgroundSessionManager
}

describe('CronManager', () => {
  let mgr: CronManager
  let bgManager: BackgroundSessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = new CronManager()
    bgManager = createMockBgManager()
    const jobsMap = (cronStore as unknown as { __jobs: Map<string, unknown> }).__jobs
    jobsMap.clear()
  })

  afterEach(async () => {
    await mgr.shutdown()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('init', () => {
    it('should initialize with no active jobs', async () => {
      await mgr.init(bgManager)
      expect(cronStore.initCronStore).toHaveBeenCalled()
    })

    it('should register active cron jobs on init', async () => {
      const cron = await import('node-cron')
      const jobsMap = (cronStore as unknown as { __jobs: Map<string, Record<string, unknown>> }).__jobs
      jobsMap.set('j1', {
        id: 'j1',
        name: 'test',
        scope: 'default',
        schedule: '*/5 * * * *',
        taskPrompt: 'hello',
        executionMode: 'isolated',
        status: 'active',
        runCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      await mgr.init(bgManager)
      expect(cron.default.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function),
        expect.any(Object)
      )
    })
  })

  describe('createJob', () => {
    it('should create and register a cron job', async () => {
      await mgr.init(bgManager)

      const job = mgr.createJob({
        name: 'Daily Report',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'Generate daily report'
      })

      expect(job.name).toBe('Daily Report')
      expect(job.status).toBe('active')
      expect(cronStore.createJob).toHaveBeenCalled()
    })

    it('should throw for invalid cron expression', async () => {
      const cron = await import('node-cron')
      ;(cron.default.validate as Mock).mockReturnValueOnce(false)

      await mgr.init(bgManager)

      expect(() =>
        mgr.createJob({
          name: 'Bad',
          scope: 'default',
          schedule: 'invalid',
          taskPrompt: 'test'
        })
      ).toThrow('Invalid cron expression')
    })

    it('should accept once: schedule without cron validation', async () => {
      await mgr.init(bgManager)
      const future = new Date(Date.now() + 60_000).toISOString()

      const job = mgr.createJob({
        name: 'One Time',
        scope: 'default',
        schedule: `once:${future}`,
        taskPrompt: 'do something'
      })

      expect(job.status).toBe('active')
    })
  })

  describe('deleteJob', () => {
    it('should unregister and delete a job', async () => {
      await mgr.init(bgManager)
      const job = mgr.createJob({
        name: 'To Delete',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'test'
      })

      const result = mgr.deleteJob(job.id)
      expect(result).toBe(true)
      expect(cronStore.deleteJob).toHaveBeenCalledWith(job.id)
    })
  })

  describe('pauseJob / resumeJob', () => {
    it('should pause an active job', async () => {
      await mgr.init(bgManager)
      const job = mgr.createJob({
        name: 'Pausable',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'test'
      })

      const paused = mgr.pauseJob(job.id)
      expect(paused).not.toBeNull()
      expect(cronStore.setJobStatus).toHaveBeenCalledWith(job.id, 'paused')
    })

    it('should resume a paused job', async () => {
      await mgr.init(bgManager)
      const job = mgr.createJob({
        name: 'Resumable',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'test'
      })

      mgr.pauseJob(job.id)
      const resumed = mgr.resumeJob(job.id)
      expect(resumed).not.toBeNull()
      expect(cronStore.setJobStatus).toHaveBeenCalledWith(job.id, 'active')
    })
  })

  describe('once: recovery on restart', () => {
    it('should re-register future once: jobs', async () => {
      const futureTime = new Date(Date.now() + 300_000).toISOString()
      const jobsMap = (cronStore as unknown as { __jobs: Map<string, Record<string, unknown>> }).__jobs
      jobsMap.set('once-future', {
        id: 'once-future',
        name: 'Future Task',
        scope: 'default',
        schedule: `once:${futureTime}`,
        taskPrompt: 'do later',
        executionMode: 'isolated',
        status: 'active',
        runCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      await mgr.init(bgManager)
      // Job should NOT be immediately executed or completed
      expect(cronStore.setJobStatus).not.toHaveBeenCalledWith('once-future', 'completed')
      expect((bgManager.trigger as Mock)).not.toHaveBeenCalled()
    })

    it('should execute recently missed once: jobs within grace period', async () => {
      const recentPast = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago
      const jobsMap = (cronStore as unknown as { __jobs: Map<string, Record<string, unknown>> }).__jobs
      jobsMap.set('once-recent', {
        id: 'once-recent',
        name: 'Missed Task',
        scope: 'default',
        schedule: `once:${recentPast}`,
        taskPrompt: 'recover me',
        executionMode: 'isolated',
        status: 'active',
        runCount: 0,
        createdAt: Date.now() - 10 * 60_000,
        updatedAt: Date.now() - 10 * 60_000
      })

      await mgr.init(bgManager)
      // Should trigger recovery execution
      expect((bgManager.trigger as Mock)).toHaveBeenCalled()
    })

    it('should mark stale once: jobs as completed beyond grace period', async () => {
      const stalePast = new Date(Date.now() - 60 * 60_000).toISOString() // 1 hour ago
      const jobsMap = (cronStore as unknown as { __jobs: Map<string, Record<string, unknown>> }).__jobs
      jobsMap.set('once-stale', {
        id: 'once-stale',
        name: 'Stale Task',
        scope: 'default',
        schedule: `once:${stalePast}`,
        taskPrompt: 'too late',
        executionMode: 'isolated',
        status: 'active',
        runCount: 0,
        createdAt: Date.now() - 2 * 60 * 60_000,
        updatedAt: Date.now() - 2 * 60 * 60_000
      })

      await mgr.init(bgManager)
      expect(cronStore.setJobStatus).toHaveBeenCalledWith('once-stale', 'completed')
      expect((bgManager.trigger as Mock)).not.toHaveBeenCalled()
    })
  })

  describe('triggerManually', () => {
    it('should trigger a job execution manually', async () => {
      await mgr.init(bgManager)
      const job = mgr.createJob({
        name: 'Manual',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'manual run'
      })

      const sessionId = await mgr.triggerManually(job.id)
      expect(sessionId).toBe('bg-sess-1')
      expect((bgManager.trigger as Mock)).toHaveBeenCalled()
    })

    it('should return null for non-existent job', async () => {
      await mgr.init(bgManager)
      const result = await mgr.triggerManually('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('shutdown', () => {
    it('should stop all tasks and close store', async () => {
      await mgr.init(bgManager)
      mgr.createJob({
        name: 'Shutdown Test',
        scope: 'default',
        schedule: '0 9 * * *',
        taskPrompt: 'test'
      })

      await mgr.shutdown()
      expect(cronStore.closeCronStore).toHaveBeenCalled()
    })
  })
})
