/**
 * EverMemService 文档记忆
 */

import { randomUUID } from 'node:crypto'
import {
  MemCell,
  RawDataType,
  MemoryType,
  MemorySourceType,
  DocumentSubType,
  MemoryRoutingContext,
  DEFAULT_USER_ID
} from '@prizm/evermemos'
import { memLog } from '../memoryLogger'
import { scopeStore } from '../../core/ScopeStore'
import {
  log,
  PrizmLLMAdapter,
  getUserManagers,
  getScopeManagers,
  mapRowToMemoryItem,
  deduplicateRows
} from './_state'
import type { MemoryItem } from '@prizm/shared'

export async function addDocumentToMemory(scope: string, documentId: string): Promise<void> {
  memLog('memory:store', { scope, documentId, detail: { phase: 'addDocumentToMemory:start' } })
  const manager = getScopeManagers(scope).memory
  const data = scopeStore.getScopeData(scope)
  const doc = data.documents.find((d) => d.id === documentId)
  if (!doc) {
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:skip', reason: 'doc_not_found' }
    })
    log.warn('Document not found for memory:', documentId, 'scope:', scope)
    return
  }

  const content = doc.content?.trim() ?? ''
  if (!content) {
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:skip', reason: 'no_content' }
    })
    log.info('Document has no content for memory:', documentId)
    return
  }

  const title = doc.title ?? documentId

  const routing: MemoryRoutingContext = {
    scope,
    sourceType: MemorySourceType.DOCUMENT,
    sourceDocumentId: documentId
  }
  const memcell: MemCell = {
    original_data: { documentId, title },
    timestamp: new Date().toISOString(),
    type: RawDataType.TEXT,
    text: content.slice(0, 8000),
    deleted: false,
    scene: 'document',
    metadata: {
      documentId,
      title
    }
  }
  try {
    await manager.processDocumentMemCell(memcell, routing)
    memLog('memory:store', {
      scope,
      documentId,
      detail: { phase: 'addDocumentToMemory:done', title, textLen: content.slice(0, 8000).length }
    })
    log.info('Document memory stored:', documentId, 'scope:', scope)
  } catch (e) {
    memLog('manager:error', {
      scope,
      documentId,
      detail: { phase: 'processDocumentMemCell' },
      error: e
    })
    throw e
  }
}

export async function deleteDocumentMemories(
  scope: string,
  documentId: string,
  subTypes: DocumentSubType[] = [DocumentSubType.OVERVIEW, DocumentSubType.FACT]
): Promise<number> {
  const managers = getScopeManagers(scope)
  let total = 0

  const allRows = await managers.scopeOnlyMemory.storage.relational.query(
    `SELECT id, sub_type FROM memories WHERE source_document_id = ? AND type = ?`,
    [documentId, MemoryType.DOCUMENT]
  )
  const rows =
    allRows.length > 0
      ? allRows
      : await managers.scopeOnlyMemory.listMemoriesByMetadata(
          'documentId',
          documentId,
          scope,
          MemoryType.DOCUMENT
        )
  for (const row of rows) {
    const r = row as { id: string; sub_type?: string }
    if (subTypes.includes(r.sub_type as DocumentSubType)) {
      await managers.scopeOnlyMemory.deleteMemory(r.id)
      total++
    }
  }
  if (total > 0) {
    log.info(
      'Deleted %d document memories for %s (subTypes=%s)',
      total,
      documentId,
      subTypes.join(',')
    )
  }
  return total
}

export async function addDocumentMigrationMemory(
  scope: string,
  documentId: string,
  title: string,
  changes: string[],
  version?: number,
  changedBy?: { type: string; sessionId?: string; apiSource?: string }
): Promise<void> {
  if (!changes.length) return
  memLog('memory:store', {
    scope,
    documentId,
    detail: { phase: 'addDocumentMigrationMemory', changesCount: changes.length, version }
  })

  const manager = getScopeManagers(scope).memory
  const groupId = scope
  const now = new Date().toISOString()
  const embeddingProvider = new PrizmLLMAdapter(scope)

  for (const change of changes) {
    if (!change.trim()) continue
    const id = randomUUID()

    let embedding: number[] | undefined
    try {
      embedding = await embeddingProvider.getEmbedding(change)
    } catch (e) {
      log.warn('Migration memory embedding failed:', e)
    }

    const migrationMeta: Record<string, unknown> = {
      documentId,
      title,
      ...(version !== undefined && { version }),
      ...(changedBy && { changedBy })
    }

    const contentStr = change.trim()

    await manager.storage.relational.insert('memories', {
      id,
      type: MemoryType.DOCUMENT,
      content: contentStr,
      user_id: DEFAULT_USER_ID,
      group_id: groupId,
      created_at: now,
      updated_at: now,
      metadata: JSON.stringify(migrationMeta),
      source_type: MemorySourceType.DOCUMENT,
      source_document_id: documentId,
      sub_type: DocumentSubType.MIGRATION
    })
    if (embedding?.length) {
      await manager.storage.vector.add(MemoryType.DOCUMENT, [
        {
          id,
          content: contentStr,
          user_id: DEFAULT_USER_ID,
          group_id: groupId,
          vector: embedding
        }
      ])
    }
  }
  log.info(
    'Migration memories added: %d changes for doc %s v%s',
    changes.length,
    documentId,
    version ?? '?'
  )
}

export async function getDocumentOverview(
  scope: string,
  documentId: string
): Promise<string | null> {
  try {
    const managers = getScopeManagers(scope)
    const rows = await managers.scopeOnlyMemory.storage.relational.query(
      `SELECT content, sub_type FROM memories WHERE source_document_id = ? AND type = ? AND sub_type = ? LIMIT 1`,
      [documentId, MemoryType.DOCUMENT, DocumentSubType.OVERVIEW]
    )
    if (rows.length > 0) {
      return (rows[0] as { content?: string }).content || null
    }
    const legacyRows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
      'documentId',
      documentId,
      scope,
      MemoryType.DOCUMENT
    )
    for (const row of legacyRows) {
      const r = row as { sub_type?: string; content?: string }
      if (r.sub_type === DocumentSubType.OVERVIEW) {
        return r.content || null
      }
    }
    return null
  } catch (e) {
    log.warn('getDocumentOverview error:', documentId, e)
    return null
  }
}

export async function getDocumentMigrationHistory(
  scope: string,
  documentId: string
): Promise<MemoryItem[]> {
  try {
    const managers = getScopeManagers(scope)
    const rows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
      'documentId',
      documentId,
      scope,
      MemoryType.DOCUMENT
    )
    return rows
      .filter((row) => {
        const r = row as any
        return r.sub_type === DocumentSubType.MIGRATION
      })
      .map((r) => mapRowToMemoryItem(r as any))
  } catch (e) {
    log.warn('getDocumentMigrationHistory error:', documentId, e)
    return []
  }
}

export async function getDocumentAllMemories(
  scope: string,
  documentId: string
): Promise<MemoryItem[]> {
  try {
    const managers = getScopeManagers(scope)
    let rows = await managers.scopeOnlyMemory.storage.relational.query(
      `SELECT * FROM memories WHERE source_document_id = ? AND type = ? ORDER BY created_at DESC`,
      [documentId, MemoryType.DOCUMENT]
    )
    if (rows.length === 0) {
      rows = await managers.scopeOnlyMemory.listMemoriesByMetadata(
        'documentId',
        documentId,
        scope,
        MemoryType.DOCUMENT
      )
    }
    return deduplicateRows(rows).map((r: any) => mapRowToMemoryItem(r))
  } catch (e) {
    log.warn('getDocumentAllMemories error:', documentId, e)
    return []
  }
}
