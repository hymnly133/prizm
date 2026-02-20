/**
 * Relation Detector — 轻量关联检测
 *
 * 在 PostMemoryExtract hook 中对新创建的记忆进行实体关联检测：
 * 1. 新记忆引用的文档 ID 匹配
 * 2. 相同关键词/实体词匹配
 */

import { createLogger } from '../../logger'
import { addRelations } from './relationStore'
import type { MemoryRelationType } from './types'
import { hookRegistry } from '../agentHooks/hookRegistry'
import type { PostMemoryExtractPayload, PostMemoryExtractDecision } from '../agentHooks/types'

const log = createLogger('RelationDetector')

/** 从文本中提取文档 ID 引用（prizm 文档 ID 格式） */
function extractDocumentRefs(text: string): string[] {
  const refs: string[] = []
  const patterns = [
    /doc[_-]?([a-zA-Z0-9_-]{8,})/g,
    /文档\s*[：:]\s*([a-zA-Z0-9_-]{8,})/g,
    /document[_-]?id[=:]\s*([a-zA-Z0-9_-]{8,})/gi
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      refs.push(match[1])
    }
  }
  return [...new Set(refs)]
}

/** 从文本中提取关键实体词（简单 heuristic） */
function extractEntityWords(text: string): Set<string> {
  const words = new Set<string>()
  const cleaned = text
    .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 30)
  for (const w of cleaned) {
    words.add(w.toLowerCase())
  }
  return words
}

/**
 * 检测新创建的记忆与已有记忆之间的关联。
 * 当前实现为轻量版：仅检测文档引用关系，不做全量语义匹配。
 */
export function detectRelations(
  newMemories: Array<{ id: string; type: string; content: string }>,
  existingMemoryIds?: string[]
): void {
  if (newMemories.length < 2 && !existingMemoryIds?.length) return

  const relations: Array<{
    sourceId: string
    targetId: string
    relationType: MemoryRelationType
    confidence?: number
  }> = []

  // 1. 新记忆之间的关联（同一批次中创建的记忆大概率相关）
  for (let i = 0; i < newMemories.length; i++) {
    for (let j = i + 1; j < newMemories.length; j++) {
      const a = newMemories[i]
      const b = newMemories[j]

      const aWords = extractEntityWords(a.content)
      const bWords = extractEntityWords(b.content)
      let overlap = 0
      for (const w of aWords) {
        if (bWords.has(w)) overlap++
      }

      if (overlap >= 2) {
        relations.push({
          sourceId: a.id,
          targetId: b.id,
          relationType: 'related_to',
          confidence: Math.min(1.0, overlap / 5)
        })
      }
    }
  }

  // 2. 文档引用关联
  for (const mem of newMemories) {
    const docRefs = extractDocumentRefs(mem.content)
    for (const docRef of docRefs) {
      relations.push({
        sourceId: mem.id,
        targetId: docRef,
        relationType: 'references',
        confidence: 0.9
      })
    }
  }

  if (relations.length > 0) {
    try {
      const added = addRelations(relations)
      log.info('Detected and stored %d/%d memory relations', added, relations.length)
    } catch (err) {
      log.warn('Failed to store memory relations:', err)
    }
  }
}

/**
 * 注册为 PostMemoryExtract hook
 */
export function registerRelationDetectorHook(): void {
  hookRegistry.register({
    id: 'builtin:relation-detector',
    event: 'PostMemoryExtract',
    priority: 200,
    callback: async (
      payload: PostMemoryExtractPayload
    ): Promise<PostMemoryExtractDecision | void> => {
      if (payload.created.length > 0) {
        detectRelations(payload.created)
      }
    }
  })
  log.info('Relation detector hook registered')
}
