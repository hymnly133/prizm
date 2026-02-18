import { createClientLogger } from '../../logger'
import { PrizmClient } from '../client'

const log = createClientLogger('AuditHTTP')

export interface AuditEntry {
  id: string
  scope: string
  actorType?: 'agent' | 'user' | 'system'
  sessionId?: string
  clientId?: string
  action: string
  toolName?: string
  resourceType?: string
  resourceId?: string
  resourceTitle?: string
  result: string
  detail?: string
  timestamp: number
}

export interface AuditQueryFilter {
  scope?: string
  sessionId?: string
  resourceType?: string
  resourceId?: string
  action?: string
  result?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

declare module '../client' {
  interface PrizmClient {
    getAuditLog(filter?: AuditQueryFilter): Promise<{ entries: AuditEntry[]; total: number }>
    getResourceHistory(
      resourceType: string,
      resourceId: string,
      scope?: string
    ): Promise<{ entries: AuditEntry[] }>
  }
}

PrizmClient.prototype.getAuditLog = async function (
  this: PrizmClient,
  filter?: AuditQueryFilter
): Promise<{ entries: AuditEntry[]; total: number }> {
  const params = new URLSearchParams()
  if (filter?.scope) params.set('scope', filter.scope)
  if (filter?.sessionId) params.set('sessionId', filter.sessionId)
  if (filter?.resourceType) params.set('resourceType', filter.resourceType)
  if (filter?.resourceId) params.set('resourceId', filter.resourceId)
  if (filter?.action) params.set('action', filter.action)
  if (filter?.result) params.set('result', filter.result)
  if (filter?.since != null) params.set('since', String(filter.since))
  if (filter?.until != null) params.set('until', String(filter.until))
  if (filter?.limit != null) params.set('limit', String(filter.limit))
  if (filter?.offset != null) params.set('offset', String(filter.offset))

  const qs = params.toString()
  const url = `/agent/audit${qs ? `?${qs}` : ''}`
  try {
    const res = await this.request<{ entries: AuditEntry[]; total: number }>(url)
    return res
  } catch (e) {
    log.error('getAuditLog failed:', e)
    return { entries: [], total: 0 }
  }
}

PrizmClient.prototype.getResourceHistory = async function (
  this: PrizmClient,
  resourceType: string,
  resourceId: string,
  scope?: string
): Promise<{ entries: AuditEntry[] }> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  const qs = params.toString()
  const url = `/agent/audit/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(
    resourceId
  )}${qs ? `?${qs}` : ''}`
  try {
    const res = await this.request<{ entries: AuditEntry[] }>(url)
    return res
  } catch (e) {
    log.error('getResourceHistory failed:', e)
    return { entries: [] }
  }
}
