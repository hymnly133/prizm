/**
 * 文档记忆服务 - 替代原 documentSummaryService
 *
 * 三层文档记忆编排：
 * 1. 总览记忆（overview）：1 条/文档，随创建/更新重建
 * 2. 原子事实记忆（fact）：多条/文档，随创建/更新重建
 * 3. 迁移记忆（migration）：多条/文档，每次更新递增追加
 *
 * 配合 documentVersionStore 进行版本控制。
 */

import { scopeStore } from '../core/ScopeStore'
import { createLogger } from '../logger'
import { getDocumentMemorySettings } from '../settings/agentToolsStore'
import { DocumentSubType } from '@prizm/evermemos'
import {
  isMemoryEnabled,
  addDocumentToMemory,
  deleteDocumentMemories,
  addDocumentMigrationMemory,
  getDocumentOverview
} from './EverMemService'
import {
  saveVersion,
  getPreviousVersion,
  computeDiff,
  computeContentHash
} from '../core/documentVersionStore'
import { UnifiedExtractor } from '@prizm/evermemos'
import { getLLMProvider, getLLMProviderName } from './index'
import { ICompletionProvider, CompletionRequest } from '@prizm/evermemos'
import { recordTokenUsage } from './tokenUsage'

const log = createLogger('DocumentMemory')

const DEFAULT_MIN_LEN = parseInt(process.env.PRIZM_DOC_SUMMARY_MIN_LEN ?? '500', 10) || 500
const ENV_DISABLED = process.env.PRIZM_DOC_SUMMARY_ENABLED === '0'

/** LLM adapter for migration extraction (reuses Prizm provider) */
class MigrationLLMAdapter implements ICompletionProvider {
  private _lastUsage: {
    totalInputTokens?: number
    totalOutputTokens?: number
    totalTokens?: number
  } | null = null

  get lastUsage() {
    return this._lastUsage
  }

  async generate(request: CompletionRequest): Promise<string> {
    const provider = getLLMProvider()
    const messages = [{ role: 'user', content: request.prompt }]
    const stream = provider.chat(messages, { temperature: request.temperature })
    let fullText = ''
    for await (const chunk of stream) {
      if (chunk.text) fullText += chunk.text
      if (chunk.usage) this._lastUsage = chunk.usage
    }
    return fullText
  }

  async getEmbedding(_text: string): Promise<number[]> {
    return []
  }
}

import type { VersionChangedBy } from '@prizm/shared'

/** 文档记忆调度选项 */
interface ScheduleDocumentMemoryOptions {
  changedBy?: VersionChangedBy
  changeReason?: string
}

/**
 * 异步触发文档记忆抽取（三层编排）
 */
export function scheduleDocumentMemory(
  scope: string,
  documentId: string,
  options?: ScheduleDocumentMemoryOptions
): void {
  const settings = getDocumentMemorySettings()
  const enabled = !ENV_DISABLED && settings?.enabled !== false
  if (!enabled) return
  if (!isMemoryEnabled()) return

  const minLen = settings?.minLen ?? DEFAULT_MIN_LEN

  void (async () => {
    try {
      const data = scopeStore.getScopeData(scope)
      const doc = data.documents.find((d) => d.id === documentId)
      if (!doc) {
        log.warn('Document not found for memory:', documentId, 'scope:', scope)
        return
      }

      const content = doc.content?.trim() ?? ''
      if (content.length < minLen) {
        log.debug('Document too short for memory:', documentId, 'len:', content.length)
        return
      }

      const title = doc.title ?? documentId
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      // 1. 获取旧版本信息（在保存新版本之前）
      const prevVersion = getPreviousVersion(scopeRoot, documentId)
      const oldContentHash = prevVersion?.contentHash ?? null

      // 2. 保存版本快照（含变更者信息）
      const newVersion = saveVersion(scopeRoot, documentId, title, content, {
        changedBy: options?.changedBy,
        changeReason: options?.changeReason
      })
      const newContentHash = newVersion.contentHash

      // 3. 获取旧总览（在删除旧记忆之前）
      let oldOverview: string | null = null
      try {
        oldOverview = await getDocumentOverview(scope, documentId)
      } catch {
        // 首次创建时无旧总览
      }

      // 4. 清除旧的 overview + fact 记忆（不删 migration）
      const deleted = await deleteDocumentMemories(scope, documentId, [
        DocumentSubType.OVERVIEW,
        DocumentSubType.FACT
      ])
      if (deleted > 0) {
        log.info('Cleared %d old document memories for %s', deleted, documentId)
      }

      // 5. 抽取新的 overview + fact（通过 addDocumentToMemory → UnifiedExtractor）
      await addDocumentToMemory(scope, documentId)

      // 6. 迁移记忆：若有旧版本且内容变化，抽取语义 diff
      const contentChanged = oldContentHash !== null && oldContentHash !== newContentHash
      if (contentChanged && prevVersion) {
        try {
          const diff = computeDiff(prevVersion.content, content)
          if (diff && !diff.includes('（无显著变更）')) {
            const migrationAdapter = new MigrationLLMAdapter()
            const extractor = new UnifiedExtractor(migrationAdapter)
            const changes = await extractor.extractMigration(title, diff, oldOverview ?? undefined)
            if (changes.length > 0) {
              await addDocumentMigrationMemory(
                scope,
                documentId,
                title,
                changes,
                newVersion.version,
                options?.changedBy
              )
            }
            if (migrationAdapter.lastUsage) {
              recordTokenUsage(
                'memory:document_migration',
                scope,
                migrationAdapter.lastUsage,
                getLLMProviderName()
              )
            }
          }
        } catch (e) {
          log.warn('Migration memory extraction failed for %s:', documentId, e)
        }
      }

      log.info(
        'Document memory complete: %s scope=%s v%d (migration=%s)',
        documentId,
        scope,
        newVersion.version,
        contentChanged ? 'yes' : 'no'
      )
    } catch (err) {
      log.error('Document memory failed:', documentId, 'scope:', scope, err)
    }
  })()
}
