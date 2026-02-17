/**
 * 内置工具：知识库工具 - 文档与记忆双向查询
 * 严格复用 @prizm/evermemos 枚举和 EverMemService 已有 API
 */

import { MemoryType, DocumentSubType, RetrieveMethod } from '@prizm/evermemos'
import { scopeStore } from '../../core/ScopeStore'
import {
  isMemoryEnabled,
  searchScopeMemories,
  getDocumentOverview,
  getDocumentMigrationHistory
} from '../EverMemService'
import type { MemorySearchOptions } from '../EverMemService'
import type { MemoryItem } from '@prizm/shared'
import { getVersionHistory } from '../../core/documentVersionStore'
import { lockManager } from '../../core/resourceLockManager'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/**
 * prizm_search_docs_by_memory - 通过语义搜索记忆，反向定位关联文档
 */
export async function executeSearchDocsByMemory(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const query = typeof ctx.args.query === 'string' ? ctx.args.query.trim() : ''
  if (!query) return { text: '请提供搜索关键词。', isError: true }

  const memoryTypesArg = Array.isArray(ctx.args.memoryTypes) ? ctx.args.memoryTypes : undefined
  const memoryTypes: MemoryType[] = memoryTypesArg?.length
    ? (memoryTypesArg.filter((t: string) =>
        Object.values(MemoryType).includes(t as MemoryType)
      ) as MemoryType[])
    : [MemoryType.DOCUMENT]

  const methodArg = typeof ctx.args.method === 'string' ? ctx.args.method : undefined
  const method =
    methodArg && Object.values(RetrieveMethod).includes(methodArg as RetrieveMethod)
      ? (methodArg as RetrieveMethod)
      : RetrieveMethod.HYBRID

  const options: MemorySearchOptions = {
    memory_types: memoryTypes,
    method,
    limit: 20
  }

  const results = await searchScopeMemories(query, ctx.scope, options)
  if (!results.length) return { text: '未找到相关记忆。' }

  // 分离文档记忆和其他记忆
  const docMemories = results.filter((m) => m.memory_type === MemoryType.DOCUMENT)
  const otherMemories = results.filter((m) => m.memory_type !== MemoryType.DOCUMENT)

  // 提取关联文档 ID，去重
  const docIdSet = new Set<string>()
  for (const m of docMemories) {
    const docId = (m.metadata as Record<string, unknown>)?.documentId as string | undefined
    if (docId) docIdSet.add(docId)
  }

  const lines: string[] = []

  if (docIdSet.size > 0) {
    lines.push(`找到 ${docIdSet.size} 个相关文档（来自 ${docMemories.length} 条文档记忆）：`)
    const data = scopeStore.getScopeData(ctx.scope)
    for (const docId of docIdSet) {
      const doc = data.documents.find((d) => d.id === docId)
      const title = doc?.title ?? '(未知文档)'
      const charCount = doc?.content?.length ?? 0

      // 找到该文档的记忆命中
      const hits = docMemories.filter(
        (m) => (m.metadata as Record<string, unknown>)?.documentId === docId
      )
      const subTypes = [...new Set(hits.map((h) => h.sub_type).filter(Boolean))]
      const hitDetail = subTypes
        .map((st) => {
          if (st === DocumentSubType.OVERVIEW) return '总览匹配'
          if (st === DocumentSubType.FACT) return '事实匹配'
          if (st === DocumentSubType.MIGRATION) return '变更历史匹配'
          return st
        })
        .join(', ')

      lines.push(`- ${docId}: ${title} (${charCount} 字) [${hitDetail}]`)
    }
  }

  if (otherMemories.length > 0) {
    lines.push('')
    lines.push(`补充上下文（${otherMemories.length} 条非文档记忆）：`)
    for (const m of otherMemories.slice(0, 5)) {
      lines.push(
        `- [${m.memory_type}] ${m.memory.slice(0, 120)}${m.memory.length > 120 ? '...' : ''}`
      )
    }
  }

  if (lines.length === 0) {
    lines.push('找到记忆但未能关联到具体文档。')
    for (const m of results.slice(0, 5)) {
      lines.push(`- [${m.memory_type}] ${m.memory.slice(0, 120)}`)
    }
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'search',
    resourceType: 'memory',
    memoryType: MemoryType.DOCUMENT,
    detail: `query="${query}" found=${results.length} docs=${docIdSet.size}`,
    result: 'success'
  })

  // 记录读取历史（对找到的文档）
  if (ctx.sessionId) {
    for (const docId of docIdSet) {
      const doc = scopeStore.getScopeData(ctx.scope).documents.find((d) => d.id === docId)
      if (doc) {
        lockManager.recordRead(ctx.scope, ctx.sessionId, 'document', docId, doc.updatedAt)
      }
    }
  }

  return { text: lines.join('\n') }
}

/**
 * prizm_get_document_memories - 获取文档的全部记忆（按子类型分组）
 */
export async function executeGetDocumentMemories(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!documentId) return { text: '请指定 documentId。', isError: true }

  // 使用已有 API 查询文档相关记忆
  const [overview, migrationHistory, scopeResults] = await Promise.all([
    getDocumentOverview(ctx.scope, documentId),
    getDocumentMigrationHistory(ctx.scope, documentId),
    searchScopeMemories(documentId, ctx.scope, {
      memory_types: [MemoryType.DOCUMENT],
      method: RetrieveMethod.KEYWORD,
      limit: 50
    })
  ])

  // 从搜索结果中提取 fact 记忆
  const factMemories = scopeResults.filter(
    (m) =>
      m.sub_type === DocumentSubType.FACT &&
      (m.metadata as Record<string, unknown>)?.documentId === documentId
  )

  const lines: string[] = []

  // 总览
  if (overview) {
    lines.push('=== 文档总览 ===')
    lines.push(overview)
    lines.push('')
  }

  // 原子事实
  if (factMemories.length > 0) {
    lines.push(`=== 原子事实 (${factMemories.length} 条) ===`)
    for (const m of factMemories) {
      lines.push(`- ${m.memory}`)
    }
    lines.push('')
  }

  // 迁移记忆
  if (migrationHistory.length > 0) {
    lines.push(`=== 变更历史 (${migrationHistory.length} 条) ===`)
    for (const m of migrationHistory) {
      const meta = m.metadata as Record<string, unknown> | undefined
      const version = meta?.version
      const changedBy = meta?.changedBy as Record<string, unknown> | undefined
      const byInfo = changedBy?.sessionId ? ` (by session:${changedBy.sessionId})` : ''
      const vInfo = version !== undefined ? `[v${version}]` : ''
      lines.push(`- ${vInfo}${byInfo} ${m.memory}`)
    }
  }

  if (lines.length === 0) {
    lines.push('该文档尚无记忆条目。')
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'read',
    resourceType: 'document',
    resourceId: documentId,
    memoryType: MemoryType.DOCUMENT,
    detail: `overview=${overview ? 'yes' : 'no'} facts=${factMemories.length} migrations=${
      migrationHistory.length
    }`,
    result: 'success'
  })

  return { text: lines.join('\n') }
}

/**
 * prizm_document_versions - 查看版本历史（含变更者和原因）
 */
export async function executeDocumentVersions(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!documentId) return { text: '请指定 documentId。', isError: true }
  const limit = typeof ctx.args.limit === 'number' ? ctx.args.limit : 20

  const history = getVersionHistory(ctx.scopeRoot, documentId)
  if (!history.versions.length) return { text: `文档 ${documentId} 尚无版本历史。` }

  const versions = history.versions.slice(-limit).reverse()
  const lines = [
    `文档 ${documentId} 版本历史（共 ${history.versions.length} 个版本，显示最近 ${versions.length} 个）：`
  ]

  for (const v of versions) {
    const byInfo = v.changedBy
      ? v.changedBy.type === 'agent'
        ? ` [agent:${v.changedBy.sessionId ?? '?'}]`
        : ` [user${v.changedBy.apiSource ? ':' + v.changedBy.apiSource : ''}]`
      : ''
    const reason = v.changeReason ? ` 原因: ${v.changeReason}` : ''
    lines.push(
      `- v${v.version} ${v.timestamp} "${v.title}" (hash:${v.contentHash})${byInfo}${reason}`
    )
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'read',
    resourceType: 'document',
    resourceId: documentId,
    detail: `versions=${history.versions.length}`,
    result: 'success'
  })

  return { text: lines.join('\n') }
}

/**
 * prizm_find_related_documents - 基于记忆关联查找语义相关文档
 */
export async function executeFindRelatedDocuments(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const documentId = typeof ctx.args.documentId === 'string' ? ctx.args.documentId : ''
  if (!documentId) return { text: '请指定 documentId。', isError: true }

  // 获取目标文档的 OVERVIEW 记忆
  const overview = await getDocumentOverview(ctx.scope, documentId)
  if (!overview) return { text: '该文档尚无总览记忆，无法查找关联文档。请先确保文档记忆已生成。' }

  // 以 overview 为 query，搜索 DOCUMENT 类型记忆（纯语义相似度）
  const results = await searchScopeMemories(overview, ctx.scope, {
    memory_types: [MemoryType.DOCUMENT],
    method: RetrieveMethod.VECTOR,
    limit: 15
  })

  // 提取关联文档 ID，排除自身
  const relatedDocIds = new Set<string>()
  const scoreMap = new Map<string, number>()
  for (const m of results) {
    const meta = m.metadata as Record<string, unknown> | undefined
    const docId = meta?.documentId as string | undefined
    if (docId && docId !== documentId) {
      relatedDocIds.add(docId)
      if (m.score !== undefined) {
        const existing = scoreMap.get(docId) ?? 0
        if (m.score > existing) scoreMap.set(docId, m.score)
      }
    }
  }

  if (relatedDocIds.size === 0) {
    return { text: '未找到语义相关的文档。' }
  }

  const data = scopeStore.getScopeData(ctx.scope)
  const lines = [`与文档 ${documentId} 语义相关的文档（${relatedDocIds.size} 个）：`]

  for (const docId of relatedDocIds) {
    const doc = data.documents.find((d) => d.id === docId)
    if (!doc) continue
    const score = scoreMap.get(docId)
    const scoreInfo = score !== undefined ? ` (相似度: ${score.toFixed(3)})` : ''
    lines.push(`- ${docId}: ${doc.title} (${doc.content?.length ?? 0} 字)${scoreInfo}`)
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'search',
    resourceType: 'document',
    resourceId: documentId,
    memoryType: MemoryType.DOCUMENT,
    detail: `related=${relatedDocIds.size}`,
    result: 'success'
  })

  return { text: lines.join('\n') }
}
