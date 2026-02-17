/**
 * Prizm Server 默认文档适配器
 */

import { createLogger } from '../logger'
import type { IDocumentsAdapter } from './interfaces'
import type {
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload
} from '../types'
import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'
import { scheduleDocumentMemory } from '../llm/documentMemoryService'

const log = createLogger('Adapter')

export class DefaultDocumentsAdapter implements IDocumentsAdapter {
  async getAllDocuments(scope: string): Promise<Document[]> {
    const data = scopeStore.getScopeData(scope)
    return [...data.documents]
  }

  async getDocumentById(scope: string, id: string): Promise<Document | null> {
    const data = scopeStore.getScopeData(scope)
    return data.documents.find((d) => d.id === id) ?? null
  }

  async createDocument(scope: string, payload: CreateDocumentPayload): Promise<Document> {
    const data = scopeStore.getScopeData(scope)
    const now = Date.now()
    const doc: Document = {
      id: genUniqueId(),
      title: payload.title || '未命名文档',
      content: payload.content ?? '',
      relativePath: '',
      createdAt: now,
      updatedAt: now
    }
    data.documents.push(doc)
    scopeStore.saveScope(scope)
    log.info('Document created:', doc.id, 'scope:', scope)
    scheduleDocumentMemory(scope, doc.id)
    return doc
  }

  async updateDocument(
    scope: string,
    id: string,
    payload: UpdateDocumentPayload
  ): Promise<Document> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.documents.findIndex((d) => d.id === id)
    if (idx < 0) throw new Error(`Document not found: ${id}`)

    const existing = data.documents[idx]
    const updated: Document = {
      ...existing,
      ...(payload.title !== undefined && { title: payload.title }),
      ...(payload.content !== undefined && { content: payload.content }),
      updatedAt: Date.now()
    }
    data.documents[idx] = updated
    scopeStore.saveScope(scope)
    log.info('Document updated:', id, 'scope:', scope)
    scheduleDocumentMemory(scope, id)
    return updated
  }

  async deleteDocument(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.documents.findIndex((d) => d.id === id)
    if (idx >= 0) {
      data.documents.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Document deleted:', id, 'scope:', scope)
    }
  }
}
