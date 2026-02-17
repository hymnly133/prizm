import { PrizmClient } from '../client'
import type { Document } from '../../types'

declare module '../client' {
  interface PrizmClient {
    listDocuments(options?: { scope?: string }): Promise<Document[]>
    getDocument(id: string, scope?: string): Promise<Document>
    createDocument(payload: { title: string; content?: string }, scope?: string): Promise<Document>
    updateDocument(
      id: string,
      payload: Partial<Pick<Document, 'title' | 'content' | 'tags'>>,
      scope?: string
    ): Promise<Document>
    deleteDocument(id: string, scope?: string): Promise<void>
    getDocumentVersions(
      id: string,
      scope?: string
    ): Promise<{
      documentId: string
      versions: Array<{
        version: number
        timestamp: string
        title: string
        contentHash: string
      }>
    }>
    getDocumentVersion(
      id: string,
      version: number,
      scope?: string
    ): Promise<{
      version: {
        version: number
        timestamp: string
        title: string
        contentHash: string
        content: string
      }
    }>
    getDocumentDiff(
      id: string,
      from: number,
      to: number,
      scope?: string
    ): Promise<{ documentId: string; from: number; to: number; diff: string }>
    restoreDocumentVersion(
      id: string,
      version: number,
      scope?: string
    ): Promise<{ document: Document; restoredVersion: number }>
  }
}

PrizmClient.prototype.listDocuments = async function (
  this: PrizmClient,
  options?: { scope?: string }
) {
  const scope = options?.scope ?? this.defaultScope
  const url = this.buildUrl('/documents', { scope })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || 'Request failed'}`)
  }
  const data = (await response.json()) as { documents: Document[] }
  return data.documents
}

PrizmClient.prototype.getDocument = async function (this: PrizmClient, id: string, scope?: string) {
  const data = await this.request<{ document: Document }>(`/documents/${encodeURIComponent(id)}`, {
    method: 'GET',
    scope
  })
  return data.document
}

PrizmClient.prototype.createDocument = async function (
  this: PrizmClient,
  payload: { title: string; content?: string },
  scope?: string
) {
  const data = await this.request<{ document: Document }>('/documents', {
    method: 'POST',
    scope,
    body: JSON.stringify(payload)
  })
  return data.document
}

PrizmClient.prototype.updateDocument = async function (
  this: PrizmClient,
  id: string,
  payload: Partial<Pick<Document, 'title' | 'content' | 'tags'>>,
  scope?: string
) {
  const data = await this.request<{ document: Document }>(`/documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    scope,
    body: JSON.stringify(payload)
  })
  return data.document
}

PrizmClient.prototype.deleteDocument = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  await this.request<void>(`/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope
  })
}

PrizmClient.prototype.getDocumentVersions = async function (
  this: PrizmClient,
  id: string,
  scope?: string
) {
  return this.request(`/documents/${encodeURIComponent(id)}/versions`, {
    method: 'GET',
    scope
  })
}

PrizmClient.prototype.getDocumentVersion = async function (
  this: PrizmClient,
  id: string,
  version: number,
  scope?: string
) {
  return this.request(`/documents/${encodeURIComponent(id)}/versions/${version}`, {
    method: 'GET',
    scope
  })
}

PrizmClient.prototype.getDocumentDiff = async function (
  this: PrizmClient,
  id: string,
  from: number,
  to: number,
  scope?: string
) {
  const url = this.buildUrl(`/documents/${encodeURIComponent(id)}/diff`, {
    scope: scope ?? this.defaultScope,
    from: String(from),
    to: String(to)
  })
  const response = await fetch(url, {
    method: 'GET',
    headers: this.buildHeaders()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text || 'Failed to get diff'}`)
  }
  return (await response.json()) as {
    documentId: string
    from: number
    to: number
    diff: string
  }
}

PrizmClient.prototype.restoreDocumentVersion = async function (
  this: PrizmClient,
  id: string,
  version: number,
  scope?: string
) {
  return this.request(`/documents/${encodeURIComponent(id)}/restore/${version}`, {
    method: 'POST',
    scope
  })
}
