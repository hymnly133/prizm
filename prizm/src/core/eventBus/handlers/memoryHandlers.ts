/**
 * 记忆系统事件处理器
 *
 * 订阅领域事件，触发 EverMemService / documentMemoryService 相关操作：
 * - document:saved → 文档记忆抽取（三层编排）
 * - document:deleted → 清理文档关联记忆（overview/fact/migration）
 * - agent:session.deleted → 刷新会话记忆缓冲
 * - agent:session.rolledBack → 精确清理被回退轮次的 P1 记忆 + 已删除文档记忆
 */

import { subscribe } from '../eventBus'
import {
  isMemoryEnabled,
  flushSessionBuffer,
  deleteMemory,
  deleteDocumentMemories
} from '../../../llm/EverMemService'
import { scheduleDocumentMemory } from '../../../llm/documentMemoryService'
import { createLogger } from '../../../logger'
import { memLog } from '../../../llm/memoryLogger'
import { scopeStore } from '../../ScopeStore'

const log = createLogger('MemoryHandler')

/**
 * 注册记忆相关的事件订阅。
 * 在 server 启动时调用一次。
 */
export function registerMemoryHandlers(): void {
  // 文档保存 → 触发文档记忆抽取（BG session 可豁免）
  subscribe(
    'document:saved',
    (data) => {
      const actor = data.actor ?? data.changedBy
      memLog('handler:document_saved', {
        scope: data.scope,
        documentId: data.documentId,
        detail: {
          memoryEnabled: isMemoryEnabled(),
          actor: actor as Record<string, unknown> | undefined,
          hasChangeReason: !!data.changeReason,
          hasPreviousContent: !!data.previousContent
        }
      })
      if (!isMemoryEnabled()) return

      if (actor && 'sessionId' in actor && actor.sessionId) {
        const scopeData = scopeStore.getScopeData(data.scope)
        const session = scopeData.agentSessions.find((s) => s.id === actor.sessionId)
        if (
          session?.kind === 'background' &&
          session.bgMeta?.memoryPolicy?.skipDocumentExtract === true
        ) {
          log.debug('Skipping document memory extraction for BG session:', actor.sessionId)
          return
        }
      }

      scheduleDocumentMemory(data.scope, data.documentId, {
        changedBy: actor,
        changeReason: data.changeReason,
        previousContent: data.previousContent
      })
    },
    'scheduleDocumentMemory'
  )

  // 文档删除 → 清理关联记忆（overview / fact / migration）
  subscribe(
    'document:deleted',
    async (data) => {
      memLog('handler:document_deleted', {
        scope: data.scope,
        documentId: data.documentId,
        detail: { memoryEnabled: isMemoryEnabled() }
      })
      if (!isMemoryEnabled()) return
      try {
        const deleted = await deleteDocumentMemories(data.scope, data.documentId)
        if (deleted > 0) {
          log.info(
            'Cleaned up %d memories for deleted document %s scope=%s',
            deleted,
            data.documentId,
            data.scope
          )
        }
      } catch (err) {
        memLog('handler:document_deleted_error', {
          scope: data.scope,
          documentId: data.documentId,
          error: err
        })
        log.warn('Document memory cleanup on delete failed:', data.documentId, err)
      }
    },
    'deleteDocumentMemories.onDelete'
  )

  // 会话删除 → 刷新记忆缓冲（确保未落盘的交互记忆被持久化）
  subscribe(
    'agent:session.deleted',
    async (data) => {
      memLog('handler:session_deleted', {
        scope: data.scope,
        sessionId: data.sessionId,
        detail: { memoryEnabled: isMemoryEnabled() }
      })
      if (!isMemoryEnabled()) return
      try {
        await flushSessionBuffer(data.scope, data.sessionId)
      } catch (err) {
        memLog('conv_memory:flush_error', {
          scope: data.scope,
          sessionId: data.sessionId,
          detail: { phase: 'session_delete_flush' },
          error: err
        })
        log.warn('memory buffer flush on session delete failed:', err)
      }
    },
    'flushSessionBuffer'
  )

  // 会话回退 → 精确清理被回退轮次的 P1 记忆 + 已删除文档的全部记忆
  subscribe(
    'agent:session.rolledBack',
    async (data) => {
      const { scope, sessionId, removedMemoryIds, deletedDocumentIds } = data
      const totalP1Ids =
        removedMemoryIds.user.length +
        removedMemoryIds.scope.length +
        removedMemoryIds.session.length

      memLog('handler:session_rolledBack', {
        scope,
        sessionId,
        detail: {
          memoryEnabled: isMemoryEnabled(),
          p1MemoryCount: totalP1Ids,
          deletedDocCount: deletedDocumentIds.length,
          checkpointId: data.checkpointId,
          remainingMessages: data.remainingMessageCount
        }
      })
      if (!isMemoryEnabled()) return

      // 1. 批量删除 P1 记忆（利用 memoryRefs.created 精确映射）
      if (totalP1Ids > 0) {
        const allIds = [
          ...removedMemoryIds.user,
          ...removedMemoryIds.scope,
          ...removedMemoryIds.session
        ]
        let deletedCount = 0
        let failedCount = 0
        for (const id of allIds) {
          try {
            const ok = await deleteMemory(id, scope)
            if (ok) deletedCount++
          } catch {
            failedCount++
          }
        }
        memLog('handler:session_rolledBack_p1_cleanup', {
          scope,
          sessionId,
          detail: {
            attempted: allIds.length,
            deleted: deletedCount,
            failed: failedCount
          }
        })
        log.info(
          'Rollback P1 memory cleanup: session=%s deleted=%d/%d failed=%d',
          sessionId,
          deletedCount,
          allIds.length,
          failedCount
        )
      }

      // 2. 清理被删除文档的全部记忆（create rollback → document deleted）
      for (const docId of deletedDocumentIds) {
        try {
          const deleted = await deleteDocumentMemories(scope, docId)
          memLog('handler:session_rolledBack_doc_cleanup', {
            scope,
            sessionId,
            documentId: docId,
            detail: { deletedMemories: deleted }
          })
          if (deleted > 0) {
            log.info('Rollback document memory cleanup: doc=%s deleted=%d memories', docId, deleted)
          }
        } catch (err) {
          log.warn('Rollback document memory cleanup failed:', docId, err)
        }
      }
    },
    'rollbackMemoryCleanup'
  )

  log.info('Memory event handlers registered')
}
