import { PrizmClient } from '../client'
import type { ClipboardItem } from '../../types'

declare module '../client' {
  interface PrizmClient {
    sendNotify(title: string, body?: string, scope?: string): Promise<{ success: boolean }>
    getClipboardHistory(options?: { limit?: number; scope?: string }): Promise<ClipboardItem[]>
    addClipboardItem(item: Omit<ClipboardItem, 'id'>, scope?: string): Promise<ClipboardItem>
    deleteClipboardItem(id: string, scope?: string): Promise<void>
  }
}

PrizmClient.prototype.sendNotify = async function (
  this: PrizmClient,
  title: string,
  body?: string,
  scope?: string
) {
  return this.request<{ success: boolean }>('/notify', {
    method: 'POST',
    scope,
    body: JSON.stringify({ title, body })
  })
}

PrizmClient.prototype.getClipboardHistory = async function (
  this: PrizmClient,
  options?: { limit?: number; scope?: string }
) {
  const query: Record<string, string | undefined> = {}
  if (typeof options?.limit === 'number') {
    query.limit = String(options.limit)
  }
  const url = this.buildUrl('/clipboard/history', query)
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { items: ClipboardItem[] }
  return data.items
}

PrizmClient.prototype.addClipboardItem = async function (
  this: PrizmClient,
  item: Omit<ClipboardItem, 'id'>,
  scope?: string
) {
  const data = await this.request<{ item: ClipboardItem }>('/clipboard', {
    method: 'POST',
    scope,
    body: JSON.stringify(item)
  })
  return data.item
}

PrizmClient.prototype.deleteClipboardItem = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  await this.request<void>(`/clipboard/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope
  })
}
