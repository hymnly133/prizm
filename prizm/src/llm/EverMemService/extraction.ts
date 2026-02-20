/**
 * EverMemService 对话记忆抽取管线
 *
 * 包含双流水线（P1 每轮轻量 + P2 批量叙述性），
 * 以及会话记忆累积器管理。
 */

import { randomUUID } from 'node:crypto'
import {
  MemCell,
  RawDataType,
  MemoryType,
  MemorySourceType,
  MemoryRoutingContext,
  getLayerForType
} from '@prizm/evermemos'
import { memLog } from '../memoryLogger'
import { executePostMemoryExtractHooks } from '../../core/agentHooks'
import { scopeStore } from '../../core/ScopeStore'
import { appendSessionMemories } from '../../core/mdStore'
import { log, getUserManagers, getScopeManagers } from './_state'
import type { MemoryIdsByLayer } from '@prizm/shared'

// ─── Accumulator state ───

interface AccumulatedRound {
  roundMessageId: string
  messages: Array<{ role: string; content: string }>
  tokenEstimate: number
  p1MemoryIds: string[]
}

interface RoundAccumulator {
  rounds: AccumulatedRound[]
  totalTokens: number
  totalRounds: number
}

const _accumulators = new Map<string, RoundAccumulator>()

const NARRATIVE_TOKEN_THRESHOLD = 4096
const NARRATIVE_ROUND_THRESHOLD = 8

const _pipelineLocks = new Map<string, Promise<void>>()

function accumulatorKey(scope: string, sessionId?: string): string {
  return `${scope}:${sessionId ?? '__nosession__'}`
}

function getOrCreateAccumulator(key: string): RoundAccumulator {
  let acc = _accumulators.get(key)
  if (!acc) {
    acc = { rounds: [], totalTokens: 0, totalRounds: 0 }
    _accumulators.set(key, acc)
  }
  return acc
}

function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const m of messages) {
    const len = m.content.length
    total += Math.ceil(len / 1.5)
  }
  return total
}

export function clearSessionBuffers(): void {
  _accumulators.clear()
  _pipelineLocks.clear()
}

export function resetSessionAccumulator(scope: string, sessionId?: string): void {
  const key = accumulatorKey(scope, sessionId)
  const acc = _accumulators.get(key)
  memLog('pipeline:accumulator_rollback_reset', {
    scope,
    sessionId,
    detail: {
      hadAccumulator: !!acc,
      discardedRounds: acc?.totalRounds ?? 0,
      discardedTokens: acc?.totalTokens ?? 0
    }
  })
  _accumulators.delete(key)
  _pipelineLocks.delete(key)
}

export async function flushSessionBuffer(
  scope: string,
  sessionId?: string
): Promise<MemoryIdsByLayer | null> {
  const key = accumulatorKey(scope, sessionId)
  const acc = _accumulators.get(key)
  if (!acc || acc.rounds.length === 0) {
    memLog('pipeline:flush_skip', {
      scope,
      sessionId,
      detail: { reason: 'no_accumulated_rounds' }
    })
    return null
  }

  memLog('pipeline:flush_start', {
    scope,
    sessionId,
    detail: {
      roundCount: acc.rounds.length,
      totalTokens: acc.totalTokens
    }
  })

  const accSnapshot = { ...acc, rounds: [...acc.rounds] }
  _accumulators.delete(key)
  _pipelineLocks.delete(key)

  return executePipeline2(scope, sessionId, key, accSnapshot)
}

// ─── Pipeline 1 + 2 Main Entry ───

export async function addMemoryInteraction(
  messages: Array<{ role: string; content: string }>,
  scope: string,
  sessionId?: string,
  roundMessageId?: string
): Promise<MemoryIdsByLayer | null> {
  const msgId = roundMessageId ?? randomUUID()

  memLog('conv_memory:chat_trigger', {
    scope,
    sessionId,
    detail: {
      msgCount: messages.length,
      msgRoles: messages.map((m) => m.role),
      msgLengths: messages.map((m) => m.content.length),
      totalChars: messages.reduce((s, m) => s + m.content.length, 0),
      roundMessageId: msgId
    }
  })

  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)
  const key = accumulatorKey(scope, sessionId)

  try {
    // ── Pipeline 1：每轮轻量抽取（event_log / profile / foresight） ──
    memLog('pipeline:p1_start', {
      scope,
      sessionId,
      detail: { roundMessageId: msgId, messageCount: messages.length }
    })

    const p1Routing: MemoryRoutingContext = {
      scope,
      sessionId,
      roundMessageId: msgId,
      sourceType: MemorySourceType.CONVERSATION
    }
    const p1Memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }

    let p1Lock: { resolve: () => void }
    const p1Promise = new Promise<void>((resolve) => {
      p1Lock = { resolve }
    })
    _pipelineLocks.set(key, p1Promise)

    let p1Created: Array<{ id: string; type: string; content: string; group_id?: string }> = []
    try {
      p1Created = await managers.memory.processPerRound(p1Memcell, p1Routing)
      memLog('pipeline:p1_done', {
        scope,
        sessionId,
        detail: {
          roundMessageId: msgId,
          createdCount: p1Created.length,
          createdTypes: p1Created.map((c) => c.type),
          createdIds: p1Created.map((c) => c.id)
        }
      })

      if (p1Created.length > 0) {
        const hookResult = await executePostMemoryExtractHooks({
          scope,
          sessionId: sessionId ?? '',
          pipeline: 'P1',
          created: p1Created.map((c) => ({ id: c.id, type: c.type, content: c.content }))
        })
        if (hookResult.excludeIds?.length) {
          p1Created = p1Created.filter((c) => !hookResult.excludeIds!.includes(c.id))
        }
      }
    } catch (e) {
      memLog('pipeline:p1_error', { scope, sessionId, error: e })
    } finally {
      p1Lock!.resolve()
    }

    // ── 累积本轮 ──
    const tokenEstimate = estimateTokens(messages)
    const acc = getOrCreateAccumulator(key)
    acc.rounds.push({
      roundMessageId: msgId,
      messages,
      tokenEstimate,
      p1MemoryIds: p1Created.map((c) => c.id)
    })
    acc.totalTokens += tokenEstimate
    acc.totalRounds += 1

    memLog('pipeline:accumulator_append', {
      scope,
      sessionId,
      detail: {
        roundMessageId: msgId,
        roundTokens: tokenEstimate,
        totalTokens: acc.totalTokens,
        totalRounds: acc.totalRounds,
        p1MemoryCount: p1Created.length
      }
    })

    // ── 构建 P1 返回结果 ──
    const byLayer: MemoryIdsByLayer = { user: [], scope: [], session: [] }
    for (const c of p1Created) {
      const layer = getLayerForType(c.type as MemoryType)
      if (layer === 'user') {
        byLayer.user.push(c.id)
      } else if (layer === 'session') {
        byLayer.session.push(c.id)
      } else {
        byLayer.scope.push(c.id)
      }
    }

    if (sessionId && p1Created.length > 0) {
      const sessionGroupPrefix = `${scope}:session:${sessionId}`
      const sessionMemories = p1Created.filter(
        (c) => c.group_id === sessionGroupPrefix || c.group_id?.startsWith(sessionGroupPrefix)
      )
      if (sessionMemories.length > 0) {
        try {
          const scopeRoot = scopeStore.getScopeRootPath(scope)
          const content = sessionMemories.map((c) => `- ${c.content}`).join('\n')
          appendSessionMemories(scopeRoot, sessionId, content)
        } catch (e) {
          log.warn('Failed to append session memories snapshot:', sessionId, e)
        }
      }
    }

    // ── Pipeline 2 阈值检查 ──
    const shouldTriggerP2 =
      acc.totalTokens >= NARRATIVE_TOKEN_THRESHOLD || acc.totalRounds >= NARRATIVE_ROUND_THRESHOLD

    memLog('pipeline:p2_threshold_check', {
      scope,
      sessionId,
      detail: {
        totalTokens: acc.totalTokens,
        totalRounds: acc.totalRounds,
        tokenThreshold: NARRATIVE_TOKEN_THRESHOLD,
        roundThreshold: NARRATIVE_ROUND_THRESHOLD,
        triggered: shouldTriggerP2
      }
    })

    if (shouldTriggerP2) {
      const accSnapshot = { ...acc, rounds: [...acc.rounds] }
      _accumulators.set(key, { rounds: [], totalTokens: 0, totalRounds: 0 })
      memLog('pipeline:accumulator_reset', { scope, sessionId })

      executePipeline2(scope, sessionId, key, accSnapshot)
        .then((p2Result) => {
          if (p2Result) {
            log.info(
              'Pipeline 2 completed: scope=%s session=%s user=%d scope=%d',
              scope,
              sessionId,
              p2Result.user.length,
              p2Result.scope.length
            )
          }
        })
        .catch((e) => {
          log.error('Pipeline 2 background execution error:', e)
        })
    }

    return p1Created.length > 0 ? byLayer : null
  } finally {
    managers.llmProvider.setSessionId(undefined)
  }
}

// ─── Pipeline 2 ───

async function executePipeline2(
  scope: string,
  sessionId: string | undefined,
  key: string,
  acc: RoundAccumulator
): Promise<MemoryIdsByLayer | null> {
  const currentLock = _pipelineLocks.get(key)
  if (currentLock) {
    await currentLock
  }

  memLog('pipeline:p2_start', {
    scope,
    sessionId,
    detail: {
      roundCount: acc.rounds.length,
      totalTokens: acc.totalTokens,
      roundMessageIds: acc.rounds.map((r) => r.roundMessageId)
    }
  })

  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)

  try {
    const allMessages: Array<{ role: string; content: string }> = []
    const allRoundIds: string[] = []
    for (const round of acc.rounds) {
      allMessages.push(...round.messages)
      allRoundIds.push(round.roundMessageId)
    }

    const allP1MemoryIds = acc.rounds.flatMap((r) => r.p1MemoryIds)
    let alreadyExtractedContext = ''
    if (allP1MemoryIds.length > 0) {
      try {
        const scopeManagers = getScopeManagers(scope)
        const placeholders = allP1MemoryIds.map(() => '?').join(',')
        const p1Rows = await scopeManagers.scopeOnlyMemory.storage.relational.query(
          `SELECT type, content FROM memories WHERE id IN (${placeholders})`,
          allP1MemoryIds
        )
        let userRows: Array<{ type: string; content: string }> = []
        try {
          userRows = await getUserManagers().memory.storage.relational.query(
            `SELECT type, content FROM memories WHERE id IN (${placeholders})`,
            allP1MemoryIds
          )
        } catch {
          // ignore
        }

        const allRows = [...p1Rows, ...userRows] as Array<{ type: string; content: string }>
        if (allRows.length > 0) {
          const sections: Record<string, string[]> = {}
          for (const row of allRows) {
            if (!sections[row.type]) sections[row.type] = []
            sections[row.type].push(row.content?.slice(0, 200) ?? '')
          }
          alreadyExtractedContext = Object.entries(sections)
            .map(([type, contents]) => `[${type}]\n${contents.map((c) => `- ${c}`).join('\n')}`)
            .join('\n\n')
        }
      } catch (e) {
        log.warn('Failed to collect P1 memory context for P2:', e)
      }
    }

    const p2Routing: MemoryRoutingContext = {
      scope,
      sessionId,
      roundMessageIds: allRoundIds,
      sourceType: MemorySourceType.CONVERSATION
    }
    const p2Memcell: MemCell = {
      original_data: allMessages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }

    let p2Created = await managers.memory.processNarrativeBatch(
      p2Memcell,
      p2Routing,
      alreadyExtractedContext || undefined
    )

    memLog('pipeline:p2_done', {
      scope,
      sessionId,
      detail: {
        createdCount: p2Created.length,
        createdTypes: p2Created.map((c: { type: string }) => c.type),
        createdIds: p2Created.map((c: { id: string }) => c.id),
        roundMessageIds: allRoundIds
      }
    })

    if (p2Created.length > 0) {
      try {
        const hookResult = await executePostMemoryExtractHooks({
          scope,
          sessionId: sessionId ?? '',
          pipeline: 'P2',
          created: p2Created.map((c: { id: string; type: string; content: string }) => ({
            id: c.id,
            type: c.type,
            content: c.content
          }))
        })
        if (hookResult.excludeIds?.length) {
          p2Created = p2Created.filter(
            (c: { id: string }) => !hookResult.excludeIds!.includes(c.id)
          )
        }
      } catch (hookErr) {
        log.warn('PostMemoryExtract hook error (P2):', hookErr)
      }
    }

    if (p2Created.length === 0) return null

    const byLayer: MemoryIdsByLayer = { user: [], scope: [], session: [] }
    for (const c of p2Created) {
      const layer = getLayerForType(c.type as MemoryType)
      if (layer === 'user') {
        byLayer.user.push(c.id)
      } else if (layer === 'session') {
        byLayer.session.push(c.id)
      } else {
        byLayer.scope.push(c.id)
      }
    }

    if (sessionId && p2Created.length > 0) {
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const content = p2Created.map((c: { content: string }) => `- [P2] ${c.content}`).join('\n')
        appendSessionMemories(scopeRoot, sessionId, content)
      } catch (e) {
        log.warn('Failed to append P2 session memories snapshot:', sessionId, e)
      }
    }

    return byLayer
  } catch (e) {
    memLog('pipeline:p2_error', { scope, sessionId, error: e })
    log.error('Pipeline 2 execution error:', e)
    return null
  } finally {
    managers.llmProvider.setSessionId(undefined)
  }
}

// ─── Session memory from rounds ───

export async function addSessionMemoryFromRounds(
  messages: Array<{ role: string; content: string }>,
  scope: string,
  sessionId: string
): Promise<void> {
  if (!messages.length) return
  memLog('conv_memory:compression_trigger', {
    scope,
    sessionId,
    detail: {
      messageCount: messages.length,
      totalChars: messages.reduce((s, m) => s + m.content.length, 0)
    }
  })
  const managers = getScopeManagers(scope)
  managers.llmProvider.setSessionId(sessionId)
  try {
    const routing: MemoryRoutingContext = {
      scope,
      sessionId,
      sessionOnly: true,
      sourceType: MemorySourceType.COMPRESSION
    }
    const memcell: MemCell = {
      original_data: messages,
      timestamp: new Date().toISOString(),
      type: RawDataType.CONVERSATION,
      deleted: false,
      scene: 'assistant'
    }
    const created = await managers.memory.processNarrativeBatch(memcell, routing)
    memLog('conv_memory:flush_result', {
      scope,
      sessionId,
      detail: {
        source: 'compression',
        createdCount: created.length,
        createdTypes: created.map((c) => c.type),
        createdIds: created.map((c) => c.id)
      }
    })
    if (created.length > 0) {
      try {
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        const content = created.map((c) => `- ${c.content}`).join('\n')
        appendSessionMemories(scopeRoot, sessionId, content)
      } catch (e) {
        log.warn('Failed to append session memories snapshot:', sessionId, e)
      }
    }
    log.info(
      'Session memory extracted from rounds, scope=%s session=%s msgs=%d',
      scope,
      sessionId,
      messages.length
    )
  } finally {
    managers.llmProvider.setSessionId(undefined)
  }
}
