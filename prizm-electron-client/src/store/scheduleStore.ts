/**
 * scheduleStore — 日程数据 + 定时任务管理 + 月历视图
 */
import { create } from 'zustand'
import type { PrizmClient } from '@prizm/client-core'
import type { ScheduleItem, CronJob, CreateSchedulePayload, CronRunLog } from '@prizm/shared'
import { subscribeSyncEvents, type SyncEventPayload } from '../events/syncEventEmitter'
import { createClientLogger } from '@prizm/client-core'

const log = createClientLogger('ScheduleStore')

export interface ConflictPair {
  schedule1: { id: string; title: string; startTime: number; endTime?: number }
  schedule2: { id: string; title: string; startTime: number; endTime?: number }
}

export interface ScheduleStoreState {
  schedules: ScheduleItem[]
  calendarItems: ScheduleItem[]
  conflicts: ConflictPair[]
  cronJobs: CronJob[]
  loading: boolean
  calendarLoading: boolean
  currentScope: string | null
  selectedDate: number | null
  selectedScheduleId: string | null

  refreshSchedules(from?: number, to?: number): Promise<void>
  refreshCalendar(from: number, to: number): Promise<void>
  refreshConflicts(from: number, to: number): Promise<void>
  refreshCronJobs(): Promise<void>

  createSchedule(payload: CreateSchedulePayload): Promise<ScheduleItem | null>
  updateSchedule(id: string, payload: Record<string, unknown>): Promise<ScheduleItem | null>
  deleteSchedule(id: string): Promise<boolean>

  createCronJob(payload: {
    name: string
    schedule: string
    taskPrompt: string
    [k: string]: unknown
  }): Promise<CronJob | null>
  deleteCronJob(id: string): Promise<boolean>
  pauseCronJob(id: string): Promise<CronJob | null>
  resumeCronJob(id: string): Promise<CronJob | null>
  triggerCronJob(id: string): Promise<string | null>
  getCronJobLogs(jobId: string, limit?: number): Promise<CronRunLog[]>

  setSelectedDate(date: number | null): void
  setSelectedScheduleId(id: string | null): void

  bind(http: PrizmClient, scope: string): void
  reset(): void
}

let _http: PrizmClient | null = null

export const useScheduleStore = create<ScheduleStoreState>()((set, get) => ({
  schedules: [],
  calendarItems: [],
  conflicts: [],
  cronJobs: [],
  loading: false,
  calendarLoading: false,
  currentScope: null,
  selectedDate: null,
  selectedScheduleId: null,

  async refreshSchedules(from?: number, to?: number) {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ loading: true })
    try {
      const items = await _http.getSchedules(scope, from, to)
      set({ schedules: items })
    } catch (err) {
      log.warn('Refresh schedules failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  async refreshCalendar(from: number, to: number) {
    const scope = get().currentScope
    if (!_http || !scope) return
    set({ calendarLoading: true })
    try {
      const items = await _http.getScheduleCalendar(scope, from, to)
      set({ calendarItems: items })
    } catch (err) {
      log.warn('Refresh calendar failed:', err)
    } finally {
      set({ calendarLoading: false })
    }
  },

  async refreshConflicts(from: number, to: number) {
    const scope = get().currentScope
    if (!_http || !scope) return
    try {
      const res = await _http.request<{ count: number; conflicts: ConflictPair[] }>(
        `/schedule/conflicts?from=${from}&to=${to}`,
        { scope }
      )
      set({ conflicts: res.conflicts })
    } catch (err) {
      log.warn('Refresh conflicts failed:', err)
    }
  },

  async refreshCronJobs() {
    const scope = get().currentScope
    if (!_http || !scope) return
    try {
      const jobs = await _http.getCronJobs(scope)
      set({ cronJobs: jobs })
    } catch (err) {
      log.warn('Refresh cron jobs failed:', err)
    }
  },

  async createSchedule(payload) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const item = await _http.createSchedule(payload, scope)
      void get().refreshSchedules()
      return item
    } catch (err) {
      log.warn('Create schedule failed:', err)
      return null
    }
  },

  async updateSchedule(id, payload) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const item = await _http.updateSchedule(id, payload, scope)
      void get().refreshSchedules()
      return item
    } catch (err) {
      log.warn('Update schedule failed:', err)
      return null
    }
  },

  async deleteSchedule(id) {
    const scope = get().currentScope
    if (!_http || !scope) return false
    try {
      await _http.deleteSchedule(id, scope)
      void get().refreshSchedules()
      return true
    } catch (err) {
      log.warn('Delete schedule failed:', err)
      return false
    }
  },

  async createCronJob(payload) {
    const scope = get().currentScope
    if (!_http || !scope) return null
    try {
      const job = await _http.createCronJob(payload, scope)
      void get().refreshCronJobs()
      return job
    } catch (err) {
      log.warn('Create cron job failed:', err)
      return null
    }
  },

  async deleteCronJob(id) {
    if (!_http) return false
    try {
      await _http.deleteCronJob(id)
      void get().refreshCronJobs()
      return true
    } catch (err) {
      log.warn('Delete cron job failed:', err)
      return false
    }
  },

  async pauseCronJob(id) {
    if (!_http) return null
    try {
      const job = await _http.pauseCronJob(id)
      void get().refreshCronJobs()
      return job
    } catch (err) {
      log.warn('Pause cron job failed:', err)
      return null
    }
  },

  async resumeCronJob(id) {
    if (!_http) return null
    try {
      const job = await _http.resumeCronJob(id)
      void get().refreshCronJobs()
      return job
    } catch (err) {
      log.warn('Resume cron job failed:', err)
      return null
    }
  },

  async triggerCronJob(id) {
    if (!_http) return null
    try {
      const res = await _http.triggerCronJob(id)
      void get().refreshCronJobs()
      return res.sessionId
    } catch (err) {
      log.warn('Trigger cron job failed:', err)
      return null
    }
  },

  async getCronJobLogs(jobId: string, limit = 20) {
    if (!_http) return []
    try {
      return await _http.request<CronRunLog[]>(
        `/cron/jobs/${encodeURIComponent(jobId)}/logs?limit=${limit}`
      )
    } catch (err) {
      log.warn('Get cron logs failed:', err)
      return []
    }
  },

  setSelectedDate(date: number | null) {
    set({ selectedDate: date })
  },

  setSelectedScheduleId(id: string | null) {
    set({ selectedScheduleId: id })
  },

  bind(http: PrizmClient, scope: string) {
    const prev = get().currentScope
    _http = http
    if (prev !== scope) {
      set({
        currentScope: scope,
        schedules: [],
        calendarItems: [],
        conflicts: [],
        cronJobs: [],
        selectedDate: null,
        selectedScheduleId: null
      })
      void get().refreshSchedules()
      void get().refreshCronJobs()
    }
  },

  reset() {
    _http = null
    set({
      currentScope: null,
      schedules: [],
      calendarItems: [],
      conflicts: [],
      cronJobs: [],
      loading: false,
      calendarLoading: false,
      selectedDate: null,
      selectedScheduleId: null
    })
  }
}))

// ==================== WS 事件订阅 ====================

const DEBOUNCE_MS = 800
let _subscribed = false
let _batchTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (_batchTimer) clearTimeout(_batchTimer)
  _batchTimer = setTimeout(() => {
    _batchTimer = null
    const store = useScheduleStore.getState()
    void store.refreshSchedules()
    void store.refreshCronJobs()
  }, DEBOUNCE_MS)
}

export function subscribeScheduleEvents(): () => void {
  if (_subscribed) return () => {}
  _subscribed = true

  const unsub = subscribeSyncEvents((eventType: string, payload?: SyncEventPayload) => {
    const store = useScheduleStore.getState()
    if (!store.currentScope) return

    const p = payload ?? {}
    if (p.scope && p.scope !== store.currentScope) return

    if (
      eventType.startsWith('schedule:') ||
      eventType.startsWith('cron:')
    ) {
      scheduleFlush()
    }
  })

  return () => {
    unsub()
    _subscribed = false
    if (_batchTimer) clearTimeout(_batchTimer)
  }
}
