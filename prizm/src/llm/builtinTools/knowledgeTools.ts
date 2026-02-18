/**
 * 内置工具：知识库工具 - 文档与记忆双向查询 + 对话轮查询
 * 严格复用 @prizm/evermemos 枚举和 EverMemService 已有 API
 */

import { MemoryType, DocumentSubType, RetrieveMethod } from '@prizm/evermemos'
import { scopeStore } from '../../core/ScopeStore'
import {
  isMemoryEnabled,
  searchScopeMemories,
  getAllMemories,
  getDocumentOverview,
  getDocumentMigrationHistory,
  getMemoryById
} from '../EverMemService'
import type { MemorySearchOptions } from '../EverMemService'
import type { MemoryItem, AgentMessage } from '@prizm/shared'
import { getTextContent } from '@prizm/shared'
import { getVersionHistory } from '../../core/documentVersionStore'
import { lockManager } from '../../core/resourceLockManager'
import type { BuiltinToolContext, BuiltinToolResult } from './types'

/** 简短日期：2025-02-18 14:30 */
function shortDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

/** 格式化记忆元信息：id + 时间（有来源引用时标注 [可追溯]） */
function formatSourceRef(m: MemoryItem): string {
  const parts: string[] = []
  parts.push(`id:${m.id}`)
  const ts = shortDate(m.created_at)
  if (ts) parts.push(ts)
  if (m.source_session_id && (m.source_round_id || m.source_round_ids?.length)) {
    parts.push('可追溯')
  }
  return ` (${parts.join(' | ')})`
}

/**
 * prizm_knowledge search — 语义搜索记忆（支持全类型），query 为空时列出全部记忆
 * 文档类型记忆会反向映射到文档，其余类型直接展示
 */
export async function executeSearchDocsByMemory(
  ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
  if (!isMemoryEnabled()) return { text: '记忆模块未启用。', isError: true }
  const query = typeof ctx.args.query === 'string' ? ctx.args.query.trim() : ''

  const memoryTypesArg = Array.isArray(ctx.args.memoryTypes) ? ctx.args.memoryTypes : undefined
  const memoryTypes: MemoryType[] | undefined = memoryTypesArg?.length
    ? (memoryTypesArg.filter((t: string) =>
        Object.values(MemoryType).includes(t as MemoryType)
      ) as MemoryType[])
    : undefined

  // query 为空 → 列出全部记忆
  if (!query) {
    const memories = await getAllMemories(ctx.scope)
    if (!memories.length) return { text: '当前无记忆条目。' }
    const filtered = memoryTypes
      ? memories.filter((m) => memoryTypes.includes(m.memory_type as MemoryType))
      : memories
    if (!filtered.length) return { text: '指定类型下无记忆条目。' }
    const lines = filtered.slice(0, 50).map((m) => {
      const text = (m.memory || '').slice(0, 120) + ((m.memory?.length ?? 0) > 120 ? '...' : '')
      const typeTag = m.memory_type ? `[${m.memory_type}]` : ''
      const ref = formatSourceRef(m)
      return `- ${typeTag} ${text}${ref}`
    })
    return { text: `共 ${filtered.length} 条记忆（显示前 ${lines.length} 条）：\n${lines.join('\n')}` }
  }

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

  const docMemories = results.filter((m) => m.memory_type === MemoryType.DOCUMENT)
  const otherMemories = results.filter((m) => m.memory_type !== MemoryType.DOCUMENT)

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
    if (lines.length > 0) lines.push('')
    lines.push(`${docIdSet.size > 0 ? '补充' : ''}记忆（${otherMemories.length} 条）：`)
    for (const m of otherMemories.slice(0, 10)) {
      const ref = formatSourceRef(m)
      const text = m.memory.slice(0, 120) + (m.memory.length > 120 ? '...' : '')
      lines.push(`- [${m.memory_type}] ${text}${ref}`)
    }
  }

  if (lines.length === 0) {
    lines.push('找到记忆但未能关联到具体文档。')
    for (const m of results.slice(0, 5)) {
      const ref = formatSourceRef(m)
      lines.push(`- [${m.memory_type}] ${m.memory.slice(0, 120)}${ref}`)
    }
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'search',
    resourceType: 'memory',
    detail: `query="${query}" found=${results.length} docs=${docIdSet.size}`,
    result: 'success'
  })

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
        : ` [user${v.changedBy.source ? ':' + v.changedBy.source : ''}]`
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

/**
 * prizm_knowledge round_lookup — 查询对话轮内容及关联记忆
 */
export async function executeRoundLookup(ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
  const memoryId = typeof ctx.args.memoryId === 'string' ? ctx.args.memoryId.trim() : ''
  let sessionId = typeof ctx.args.sessionId === 'string' ? ctx.args.sessionId.trim() : ''
  let messageId = typeof ctx.args.messageId === 'string' ? ctx.args.messageId.trim() : ''
  const limit = typeof ctx.args.limit === 'number' ? Math.min(ctx.args.limit, 20) : 10

  // 优先级：memoryId → 自动解析 sessionId/messageId
  if (memoryId) {
    const mem = await getMemoryById(memoryId, ctx.scope)
    if (!mem) return { text: `记忆 ${memoryId} 不存在。`, isError: true }

    const lines: string[] = []
    lines.push(`记忆 ${memoryId}:`)
    lines.push(`  类型: ${mem.memory_type ?? '未知'}`)
    lines.push(`  内容: ${mem.memory}`)
    lines.push(`  时间: ${shortDate(mem.created_at)}`)

    if (!mem.source_session_id) {
      lines.push(`  ⚠ 该记忆无会话来源引用（可能来自文档或手动创建）`)
      if (mem.source_document_id) lines.push(`  文档来源: ${mem.source_document_id}`)
      return { text: lines.join('\n') }
    }

    sessionId = mem.source_session_id
    const roundIds: string[] = []
    if (mem.source_round_id) roundIds.push(mem.source_round_id)
    if (mem.source_round_ids?.length) {
      for (const rid of mem.source_round_ids) {
        if (!roundIds.includes(rid)) roundIds.push(rid)
      }
    }

    const data = scopeStore.getScopeData(ctx.scope)
    const session = data.agentSessions.find((s) => s.id === sessionId)
    if (!session) {
      lines.push(`  来源会话: ${sessionId}（已删除或不可访问）`)
      if (roundIds.length) lines.push(`  来源消息: ${roundIds.join(', ')}`)
      return { text: lines.join('\n') }
    }

    lines.push(`  来源会话: ${sessionId}`)
    lines.push('')

    for (const rid of roundIds) {
      const idx = session.messages.findIndex((m) => m.id === rid)
      if (idx < 0) {
        lines.push(`  消息 ${rid}: 不存在（可能已被压缩）`)
        continue
      }
      const msg = session.messages[idx]
      const text = getTextContent(msg)
      const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text
      lines.push(
        `--- 消息 #${idx + 1} [${msg.role}] ${shortDate(msg.createdAt as unknown as string)} ---`
      )
      lines.push(truncated)

      // 显示前后各 1 条上下文
      const before = idx > 0 ? session.messages[idx - 1] : null
      const after = idx < session.messages.length - 1 ? session.messages[idx + 1] : null
      if (before || after) {
        lines.push('')
        lines.push('上下文:')
        if (before) {
          const bt = getTextContent(before)
          lines.push(
            `  ↑ #${idx} [${before.role}] ${bt.slice(0, 100)}${bt.length > 100 ? '...' : ''}`
          )
        }
        if (after) {
          const at = getTextContent(after)
          lines.push(
            `  ↓ #${idx + 2} [${after.role}] ${at.slice(0, 100)}${at.length > 100 ? '...' : ''}`
          )
        }
      }
      lines.push('')
    }

    ctx.emitAudit({
      toolName: ctx.toolName,
      action: 'read',
      resourceType: 'memory',
      resourceId: memoryId,
      detail: `round_lookup via memoryId, session=${sessionId}, rounds=${roundIds.join(',')}`,
      result: 'success'
    })

    return { text: lines.join('\n') }
  }

  // 后备：直接通过 sessionId + messageId 查询
  const targetSessionId = sessionId || ctx.sessionId
  if (!targetSessionId && !messageId) {
    return { text: '请提供 memoryId（推荐）、或 sessionId/messageId。', isError: true }
  }

  if (!targetSessionId) {
    return { text: '无法确定会话 ID（未提供 sessionId 且当前无活跃会话）。', isError: true }
  }

  const data = scopeStore.getScopeData(ctx.scope)
  const session = data.agentSessions.find((s) => s.id === targetSessionId)
  if (!session) {
    return { text: `会话 ${targetSessionId} 不存在或已删除。` }
  }

  const lines: string[] = []

  if (messageId) {
    const msgIndex = session.messages.findIndex((m) => m.id === messageId)
    if (msgIndex < 0) {
      return {
        text: `消息 ${messageId} 在会话 ${targetSessionId} 中不存在（共 ${session.messages.length} 条消息）。`
      }
    }

    const msg = session.messages[msgIndex]
    const text = getTextContent(msg)
    const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text
    lines.push(
      `=== 消息 ${messageId} (${msg.role}, #${msgIndex + 1}/${session.messages.length}) ===`
    )
    lines.push(`时间: ${new Date(msg.createdAt).toLocaleString()}`)
    if (msg.model) lines.push(`模型: ${msg.model}`)
    lines.push(`内容: ${truncated}`)

    if (msg.memoryRefs) {
      const refs = msg.memoryRefs
      const injected =
        (refs.injected?.user?.length ?? 0) +
        (refs.injected?.scope?.length ?? 0) +
        (refs.injected?.session?.length ?? 0)
      const created =
        (refs.created?.user?.length ?? 0) +
        (refs.created?.scope?.length ?? 0) +
        (refs.created?.session?.length ?? 0)
      if (injected > 0 || created > 0) {
        lines.push(`记忆: 注入 ${injected} 条, 产出 ${created} 条`)
      }
    }

    const ctxStart = Math.max(0, msgIndex - 2)
    const ctxEnd = Math.min(session.messages.length, msgIndex + 3)
    if (ctxEnd - ctxStart > 1) {
      lines.push('')
      lines.push('--- 上下文 ---')
      for (let i = ctxStart; i < ctxEnd; i++) {
        const cm = session.messages[i]
        const ct = getTextContent(cm)
        const marker = i === msgIndex ? '>>>' : '   '
        lines.push(
          `${marker} #${i + 1} [${cm.role}] ${ct.slice(0, 80)}${ct.length > 80 ? '...' : ''}`
        )
      }
    }
  } else {
    lines.push(
      `会话 ${targetSessionId} 共 ${session.messages.length} 条消息，显示最近 ${Math.min(
        limit,
        session.messages.length
      )} 条：`
    )
    const recentMessages = session.messages.slice(-limit)
    const startIdx = session.messages.length - recentMessages.length
    for (let i = 0; i < recentMessages.length; i++) {
      const m = recentMessages[i]
      const text = getTextContent(m)
      const truncated = text.slice(0, 100) + (text.length > 100 ? '...' : '')
      const memInfo = m.memoryRefs ? ' [有记忆引用]' : ''
      lines.push(`#${startIdx + i + 1} [${m.role}] id:${m.id.slice(0, 8)} ${truncated}${memInfo}`)
    }
  }

  ctx.emitAudit({
    toolName: ctx.toolName,
    action: 'read',
    resourceType: 'memory',
    resourceId: targetSessionId,
    detail: messageId ? `round_lookup message=${messageId}` : `round_lookup recent=${limit}`,
    result: 'success'
  })

  return { text: lines.join('\n') }
}
