import { PrizmClient } from '../client'
import type { ScheduleItem, CreateSchedulePayload, UpdateSchedulePayload, CronJob } from '@prizm/shared'

declare module '../client' {
  interface PrizmClient {
    getSchedules(scope?: string, from?: number, to?: number): Promise<ScheduleItem[]>
    getSchedule(scheduleId: string, scope?: string): Promise<ScheduleItem | null>
    createSchedule(payload: CreateSchedulePayload, scope?: string): Promise<ScheduleItem>
    updateSchedule(
      scheduleId: string,
      payload: UpdateSchedulePayload,
      scope?: string
    ): Promise<ScheduleItem>
    deleteSchedule(scheduleId: string, scope?: string): Promise<void>
    getScheduleCalendar(scope: string, from: number, to: number): Promise<ScheduleItem[]>

    getCronJobs(scope?: string, status?: string): Promise<CronJob[]>
    createCronJob(
      payload: { name: string; schedule: string; taskPrompt: string; [k: string]: unknown },
      scope?: string
    ): Promise<CronJob>
    deleteCronJob(jobId: string): Promise<void>
    pauseCronJob(jobId: string): Promise<CronJob>
    resumeCronJob(jobId: string): Promise<CronJob>
    triggerCronJob(jobId: string): Promise<{ sessionId: string }>
  }
}

PrizmClient.prototype.getSchedules = async function (
  this: PrizmClient,
  scope?: string,
  from?: number,
  to?: number
) {
  let path = '/schedule'
  const params: string[] = []
  if (from != null) params.push(`from=${from}`)
  if (to != null) params.push(`to=${to}`)
  if (params.length) path += `?${params.join('&')}`
  return this.request<ScheduleItem[]>(path, { scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.getSchedule = async function (
  this: PrizmClient,
  scheduleId: string,
  scope?: string
) {
  try {
    const data = await this.request<ScheduleItem>(
      `/schedule/${encodeURIComponent(scheduleId)}`,
      { scope }
    )
    return data
  } catch {
    return null
  }
}

PrizmClient.prototype.createSchedule = async function (
  this: PrizmClient,
  payload: CreateSchedulePayload,
  scope?: string
) {
  return this.request<ScheduleItem>('/schedule', {
    method: 'POST',
    scope,
    body: JSON.stringify(payload)
  })
}

PrizmClient.prototype.updateSchedule = async function (
  this: PrizmClient,
  scheduleId: string,
  payload: UpdateSchedulePayload,
  scope?: string
) {
  return this.request<ScheduleItem>(
    `/schedule/${encodeURIComponent(scheduleId)}`,
    {
      method: 'PATCH',
      scope,
      body: JSON.stringify(payload)
    }
  )
}

PrizmClient.prototype.deleteSchedule = async function (
  this: PrizmClient,
  scheduleId: string,
  scope?: string
) {
  await this.request<void>(`/schedule/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    scope
  })
}

PrizmClient.prototype.getScheduleCalendar = async function (
  this: PrizmClient,
  scope: string,
  from: number,
  to: number
) {
  return this.request<ScheduleItem[]>(`/schedule/calendar?from=${from}&to=${to}`, { scope })
}

PrizmClient.prototype.getCronJobs = async function (
  this: PrizmClient,
  scope?: string,
  status?: string
) {
  let path = '/cron/jobs'
  if (status) path += `?status=${encodeURIComponent(status)}`
  return this.request<CronJob[]>(path, { scope: scope ?? this.defaultScope })
}

PrizmClient.prototype.createCronJob = async function (
  this: PrizmClient,
  payload: { name: string; schedule: string; taskPrompt: string; [k: string]: unknown },
  scope?: string
) {
  return this.request<CronJob>('/cron/jobs', {
    method: 'POST',
    scope,
    body: JSON.stringify(payload)
  })
}

PrizmClient.prototype.deleteCronJob = async function (this: PrizmClient, jobId: string) {
  await this.request<void>(`/cron/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
}

PrizmClient.prototype.pauseCronJob = async function (this: PrizmClient, jobId: string) {
  return this.request<CronJob>(`/cron/jobs/${encodeURIComponent(jobId)}/pause`, { method: 'POST' })
}

PrizmClient.prototype.resumeCronJob = async function (this: PrizmClient, jobId: string) {
  return this.request<CronJob>(`/cron/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' })
}

PrizmClient.prototype.triggerCronJob = async function (this: PrizmClient, jobId: string) {
  return this.request<{ sessionId: string }>(
    `/cron/jobs/${encodeURIComponent(jobId)}/trigger`,
    { method: 'POST' }
  )
}
