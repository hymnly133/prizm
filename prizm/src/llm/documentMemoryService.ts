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
import { emit } from '../core/eventBus'
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
  getLatestVersion,
  computeDiff,
  computeContentHash
} from '../core/documentVersionStore'
import { UnifiedExtractor } from '@prizm/evermemos'
import { BasePrizmLLMAdapter } from './prizmLLMAdapter'
import { memLog } from './memoryLogger'

const log = createLogger('DocumentMemory')

const DEFAULT_MIN_LEN = parseInt(process.env.PRIZM_DOC_SUMMARY_MIN_LEN ?? '500', 10) || 500
const ENV_DISABLED = process.env.PRIZM_DOC_SUMMARY_ENABLED === '0'

import type { VersionChangedBy } from '@prizm/shared'

// ─── 提取状态跟踪 ───

/** 正在提取中的文档，key: `${scope}:${documentId}`，value: 开始时间戳 */
const _extractingDocuments = new Map<string, number>()

function extractingKey(scope: string, documentId: string): string {
  return `${scope}:${documentId}`
}

function markExtracting(scope: string, documentId: string): void {
  _extractingDocuments.set(extractingKey(scope, documentId), Date.now())
}

function unmarkExtracting(scope: string, documentId: string): void {
  _extractingDocuments.delete(extractingKey(scope, documentId))
}

/** 检查文档是否正在提取记忆 */
export function isDocumentExtracting(scope: string, documentId: string): boolean {
  const ts = _extractingDocuments.get(extractingKey(scope, documentId))
  if (ts == null) return false
  // 超时保护：超过 5 分钟视为异常，自动清除
  if (Date.now() - ts > 5 * 60 * 1000) {
    _extractingDocuments.delete(extractingKey(scope, documentId))
    return false
  }
  return true
}

// ─── 调度选项 ───

/** 文档记忆调度选项 */
interface ScheduleDocumentMemoryOptions {
  changedBy?: VersionChangedBy
  changeReason?: string
  /** 更新前的旧内容，用于懒补齐版本 v1 */
  previousContent?: string
}

/**
 * 异步触发文档记忆抽取（三层编排）
 *
 * 懒补齐策略：若文档无版本历史但传入了 previousContent（说明是对历史遗留文档的首次编辑），
 * 先用 previousContent 创建 v1 作为基线，再正常保存新内容为 v2 并触发迁移记忆。
 */
export function scheduleDocumentMemory(
  scope: string,
  documentId: string,
  options?: ScheduleDocumentMemoryOptions
): void {
  const settings = getDocumentMemorySettings()
  const enabled = !ENV_DISABLED && settings?.enabled !== false
  if (!enabled) {
    memLog('doc_memory:skip', {
      scope,
      documentId,
      detail: { reason: 'disabled_by_env_or_settings' }
    })
    return
  }
  if (!isMemoryEnabled()) {
    memLog('doc_memory:skip', { scope, documentId, detail: { reason: 'memory_not_enabled' } })
    return
  }

  if (isDocumentExtracting(scope, documentId)) {
    memLog('doc_memory:skip', {
      scope,
      documentId,
      detail: { reason: 'already_extracting' }
    })
    log.debug(
      'scheduleDocumentMemory: skipped (already extracting) doc=%s scope=%s',
      documentId,
      scope
    )
    return
  }

  const minLen = settings?.minLen ?? DEFAULT_MIN_LEN
  memLog('doc_memory:schedule', {
    scope,
    documentId,
    detail: { minLen, changedBy: options?.changedBy }
  })

  void (async () => {
    markExtracting(scope, documentId)
    try {
      const data = scopeStore.getScopeData(scope)
      const doc = data.documents.find((d) => d.id === documentId)
      if (!doc) {
        memLog('doc_memory:skip', { scope, documentId, detail: { reason: 'document_not_found' } })
        log.warn('Document not found for memory:', documentId, 'scope:', scope)
        return
      }

      const content = doc.content?.trim() ?? ''
      const skipMemoryExtraction = content.length < minLen
      const title = doc.title ?? documentId
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      memLog('doc_memory:start', {
        scope,
        documentId,
        detail: { title, contentLen: content.length, scopeRoot }
      })

      // 1. 获取当前最新版本（在保存新版本之前），用于 diff 比较
      let prevVersion = getLatestVersion(scopeRoot, documentId)

      // ── 懒补齐：无版本历史 + 有旧内容 → 先创建 v1 作为基线 ──
      if (!prevVersion && options?.previousContent != null) {
        const prevHash = computeContentHash(options.previousContent)
        const newHash = computeContentHash(content)
        if (prevHash !== newHash && options.previousContent.trim().length > 0) {
          memLog('doc_memory:version_backfill', {
            scope,
            documentId,
            detail: { reason: 'lazy_backfill_v1', prevContentLen: options.previousContent.length }
          })
          const v1 = saveVersion(scopeRoot, documentId, title, options.previousContent, {
            changedBy: { type: 'system' } as VersionChangedBy,
            changeReason: 'Lazy backfill: baseline version before first tracked edit'
          })
          prevVersion = v1
          log.info(
            'Lazy backfill v1 for %s scope=%s (baseline from previousContent)',
            documentId,
            scope
          )
        }
      }

      const oldContentHash = prevVersion?.contentHash ?? null

      // 2. 保存版本快照（含变更者信息）
      const newVersion = saveVersion(scopeRoot, documentId, title, content, {
        changedBy: options?.changedBy,
        changeReason: options?.changeReason
      })
      const newContentHash = newVersion.contentHash
      memLog('doc_memory:start', {
        scope,
        documentId,
        detail: {
          phase: 'version_compare',
          prevVersion: prevVersion?.version ?? null,
          newVersion: newVersion.version,
          oldContentHash,
          newContentHash,
          contentChanged: oldContentHash !== null && oldContentHash !== newContentHash
        }
      })

      // 版本已保存；若内容过短则跳过记忆提取（版本快照不受限制）
      if (skipMemoryExtraction) {
        memLog('doc_memory:skip', {
          scope,
          documentId,
          detail: {
            reason: 'too_short_for_memory',
            contentLen: content.length,
            minLen,
            versionSaved: newVersion.version
          }
        })
        log.debug(
          'Document too short for memory extraction (version saved): %s len=%d v%d',
          documentId,
          content.length,
          newVersion.version
        )
        return
      }

      // 3. 获取旧总览（在删除旧记忆之前）
      let oldOverview: string | null = null
      try {
        oldOverview = await getDocumentOverview(scope, documentId)
      } catch {
        // 首次创建时无旧总览
      }

      // 4. 清除旧的 overview + fact 记忆（不删 migration）
      memLog('doc_memory:delete_old', {
        scope,
        documentId,
        detail: { subTypes: ['overview', 'fact'] }
      })
      const deleted = await deleteDocumentMemories(scope, documentId, [
        DocumentSubType.OVERVIEW,
        DocumentSubType.FACT
      ])
      if (deleted > 0) {
        log.info('Cleared %d old document memories for %s', deleted, documentId)
      }
      memLog('doc_memory:delete_old', { scope, documentId, detail: { deletedCount: deleted } })

      // 5. 抽取新的 overview + fact（通过 addDocumentToMemory → UnifiedExtractor）
      memLog('doc_memory:extract_start', { scope, documentId, detail: { phase: 'overview+fact' } })
      await addDocumentToMemory(scope, documentId)
      memLog('doc_memory:extract_done', { scope, documentId, detail: { phase: 'overview+fact' } })

      // 6. 迁移记忆：若有旧版本且内容变化，抽取语义 diff
      const contentChanged = oldContentHash !== null && oldContentHash !== newContentHash
      if (contentChanged && prevVersion) {
        memLog('doc_memory:migration_start', {
          scope,
          documentId,
          detail: { version: newVersion.version, prevVersion: prevVersion.version }
        })
        try {
          const diff = computeDiff(prevVersion.content, content)
          if (diff && !diff.includes('（无显著变更）')) {
            const migrationAdapter = new BasePrizmLLMAdapter({
              scope,
              defaultCategory: 'memory:document_migration'
            })
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
              memLog('doc_memory:migration_done', {
                scope,
                documentId,
                detail: { version: newVersion.version, changesCount: changes.length }
              })
            } else {
              memLog('doc_memory:migration_skip', {
                scope,
                documentId,
                detail: { reason: 'no_changes_extracted' }
              })
            }
            // token usage 已由 BasePrizmLLMAdapter.generate() 内部自动记录
          } else {
            memLog('doc_memory:migration_skip', {
              scope,
              documentId,
              detail: { reason: diff ? 'no_significant_change' : 'no_diff' }
            })
          }
        } catch (e) {
          memLog('doc_memory:error', {
            scope,
            documentId,
            detail: { phase: 'migration' },
            error: e
          })
          log.warn('Migration memory extraction failed for %s:', documentId, e)
        }
      } else {
        memLog('doc_memory:migration_skip', {
          scope,
          documentId,
          detail: { reason: contentChanged ? 'no_prev_version' : 'content_unchanged' }
        })
      }

      // ── 文档记忆更新通知 ──
      const updatedSubTypes = ['overview', 'fact']
      if (contentChanged && prevVersion) updatedSubTypes.push('migration')
      void emit('document:memory.updated', {
        scope,
        documentId,
        title,
        updatedSubTypes
      })

      memLog('doc_memory:complete', {
        scope,
        documentId,
        detail: {
          version: newVersion.version,
          contentChanged,
          deletedOld: deleted,
          hasMigration: contentChanged && !!prevVersion
        }
      })
      log.info(
        'Document memory complete: %s scope=%s v%d (migration=%s)',
        documentId,
        scope,
        newVersion.version,
        contentChanged ? 'yes' : 'no'
      )
    } catch (err) {
      memLog('doc_memory:error', { scope, documentId, error: err })
      log.error('Document memory failed:', documentId, 'scope:', scope, err)
    } finally {
      unmarkExtracting(scope, documentId)
    }
  })()
}
