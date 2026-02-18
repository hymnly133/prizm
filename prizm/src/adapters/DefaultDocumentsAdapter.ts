/**
 * Prizm Server 默认文档适配器
 * 内部代理到 DocumentService，确保事件、审计等副作用由 Service 统一管理。
 * 保留接口兼容性，供外部集成使用。
 */

import { createLogger } from '../logger'
import type { IDocumentsAdapter } from './interfaces'
import type { Document, CreateDocumentPayload, UpdateDocumentPayload } from '../types'
import * as documentService from '../services/documentService'

const log = createLogger('Adapter')

export class DefaultDocumentsAdapter implements IDocumentsAdapter {
  async getAllDocuments(scope: string): Promise<Document[]> {
    return documentService.listDocuments(scope)
  }

  async getDocumentById(scope: string, id: string): Promise<Document | null> {
    return documentService.getDocument(scope, id)
  }

  async createDocument(scope: string, payload: CreateDocumentPayload): Promise<Document> {
    const doc = await documentService.createDocument(
      { scope, actor: { type: 'system', source: 'adapter:documents' } },
      payload
    )
    log.info('Document created via adapter:', doc.id, 'scope:', scope)
    return doc
  }

  async updateDocument(
    scope: string,
    id: string,
    payload: UpdateDocumentPayload
  ): Promise<Document> {
    const doc = await documentService.updateDocument(
      { scope, actor: { type: 'system', source: 'adapter:documents' } },
      id,
      payload
    )
    log.info('Document updated via adapter:', id, 'scope:', scope)
    return doc
  }

  async deleteDocument(scope: string, id: string): Promise<void> {
    try {
      await documentService.deleteDocument(
        { scope, actor: { type: 'system', source: 'adapter:documents' } },
        id
      )
      log.info('Document deleted via adapter:', id, 'scope:', scope)
    } catch {
      // 文档不存在时静默忽略，保持旧行为兼容
    }
  }
}
