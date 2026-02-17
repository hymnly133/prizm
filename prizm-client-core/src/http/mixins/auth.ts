import { PrizmClient } from '../client'

declare module '../client' {
  interface PrizmClient {
    listScopes(): Promise<string[]>
    listScopesWithInfo(): Promise<{
      scopes: string[]
      descriptions: Record<string, { label: string; description: string }>
      scopeDetails?: Record<string, { path: string | null; label: string; builtin: boolean }>
    }>
    registerScope(payload: {
      id: string
      path: string
      label?: string
    }): Promise<{ scope: { id: string; path: string; label: string } }>
    updateScope(
      id: string,
      payload: { label?: string }
    ): Promise<{ scope: { id: string; path: string; label: string } }>
    unregisterScope(id: string): Promise<void>
  }
}

PrizmClient.prototype.listScopes = async function (this: PrizmClient) {
  const data = await this.request<{ scopes: string[] }>('/auth/scopes')
  return data.scopes ?? []
}

PrizmClient.prototype.listScopesWithInfo = async function (this: PrizmClient) {
  const data = await this.request<{
    scopes: string[]
    descriptions?: Record<string, { label: string; description: string }>
    scopeDetails?: Record<string, { path: string | null; label: string; builtin: boolean }>
  }>('/auth/scopes')
  return {
    scopes: data.scopes ?? [],
    descriptions: data.descriptions ?? {},
    scopeDetails: data.scopeDetails
  }
}

PrizmClient.prototype.registerScope = async function (
  this: PrizmClient,
  payload: { id: string; path: string; label?: string }
) {
  return this.request('/auth/scopes', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

PrizmClient.prototype.updateScope = async function (
  this: PrizmClient,
  id: string,
  payload: { label?: string }
) {
  return this.request(`/auth/scopes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  })
}

PrizmClient.prototype.unregisterScope = async function (this: PrizmClient, id: string) {
  await this.request(`/auth/scopes/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}
