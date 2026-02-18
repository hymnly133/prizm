import type { ResourceLockInfo } from '@prizm/shared'
import { createClientLogger } from '../../logger'
import { PrizmClient } from '../client'

const log = createClientLogger('LocksHTTP')

export type { ResourceLockInfo }

export interface ResourceStatusInfo {
  resourceType: string
  resourceId: string
  scope: string
  lock: ResourceLockInfo | null
  recentReads: {
    id: string
    scope: string
    sessionId: string
    resourceType: string
    resourceId: string
    readVersion: number
    readAt: number
  }[]
}

declare module '../client' {
  interface PrizmClient {
    getScopeLocks(scope?: string): Promise<ResourceLockInfo[]>
    getSessionLocks(sessionId: string, scope?: string): Promise<ResourceLockInfo[]>
    getResourceStatus(
      resourceType: string,
      resourceId: string,
      scope?: string
    ): Promise<ResourceStatusInfo>
    forceReleaseLock(
      resourceType: string,
      resourceId: string,
      scope?: string,
      reason?: string
    ): Promise<{ released: boolean; previousHolder?: { sessionId: string; acquiredAt: number } }>
  }
}

PrizmClient.prototype.getScopeLocks = async function (
  this: PrizmClient,
  scope?: string
): Promise<ResourceLockInfo[]> {
  try {
    const res = await this.request<{ data: ResourceLockInfo[] }>('/agent/locks', { scope })
    return res.data ?? []
  } catch (e) {
    log.error('getScopeLocks failed:', e)
    return []
  }
}

PrizmClient.prototype.getSessionLocks = async function (
  this: PrizmClient,
  sessionId: string,
  scope?: string
): Promise<ResourceLockInfo[]> {
  try {
    const res = await this.request<{ data: ResourceLockInfo[] }>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/locks`,
      { scope }
    )
    return res.data ?? []
  } catch (e) {
    log.error('getSessionLocks failed:', e)
    return []
  }
}

PrizmClient.prototype.getResourceStatus = async function (
  this: PrizmClient,
  resourceType: string,
  resourceId: string,
  scope?: string
): Promise<ResourceStatusInfo> {
  try {
    const res = await this.request<{ data: ResourceStatusInfo }>(
      `/agent/resource-status/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
      { scope }
    )
    return res.data
  } catch (e) {
    log.error('getResourceStatus failed:', e)
    return { resourceType, resourceId, scope: scope ?? 'default', lock: null, recentReads: [] }
  }
}

PrizmClient.prototype.forceReleaseLock = async function (
  this: PrizmClient,
  resourceType: string,
  resourceId: string,
  scope?: string,
  reason?: string
): Promise<{ released: boolean; previousHolder?: { sessionId: string; acquiredAt: number } }> {
  try {
    const res = await this.request<{
      released: boolean
      previousHolder?: { sessionId: string; acquiredAt: number }
    }>(
      `/agent/locks/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/force-release`,
      {
        scope,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason ?? 'User forced release' })
      }
    )
    return res
  } catch (e) {
    log.error('forceReleaseLock failed:', e)
    return { released: false }
  }
}
