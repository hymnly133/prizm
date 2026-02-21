/**
 * BackgroundSessionManager (Task Orchestrator)
 *
 * BG Session 的轻量编排模块，负责：
 * - 触发并执行 BG Session（异步/同步）
 * - 超时控制与取消
 * - 结果守卫（检查 prizm_set_result 是否被调用）
 * - 活跃运行追踪与并发限制
 *
 * 不再包含：BG 专用 chunk 广播、孤儿恢复、列表/结果查询/摘要统计等
 * 路由级功能已移除，这些数据直接从 session 读取。
 */

import type { AgentSession, BgSessionMeta, BgStatus, SessionMemoryPolicy } from '@prizm/shared'
import type { IAgentAdapter } from '../../adapters/interfaces'
import type { IChatService } from '../interfaces'
import type { ActiveRunEntry, BgConcurrencyLimits, BgRunResult, BgTriggerPayload } from './types'
import { needsResultGuard, getResultGuardPrompt, extractFallbackResult } from './resultGuard'
import { observerRegistry } from './observerRegistry'
import { buildBgSystemPreamble } from './preambleBuilder'
import { validateJsonSchema } from './schemaValidation'
import { createLogger } from '../../logger'
import { emit } from '../eventBus/eventBus'

const log = createLogger('BgSessionManager')

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_BG_MEMORY_POLICY: SessionMemoryPolicy = {
  skipPerRoundExtract: true,
  skipNarrativeBatchExtract: true,
  skipDocumentExtract: false,
  skipConversationSummary: true
}

export class BackgroundSessionManager {
  private adapter: IAgentAdapter | undefined
  private chatService: IChatService | undefined
  private activeRuns = new Map<string, ActiveRunEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private limits: BgConcurrencyLimits = {
    maxPerParent: 5,
    maxGlobal: 10,
    maxDepth: 2
  }

  async init(
    adapter: IAgentAdapter | undefined,
    chatService: IChatService,
    limits?: Partial<BgConcurrencyLimits>
  ): Promise<void> {
    this.adapter = adapter
    this.chatService = chatService
    if (limits) Object.assign(this.limits, limits)
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
    log.info('BackgroundSessionManager initialized')
  }

  async shutdown(): Promise<void> {
    for (const [sessionId, entry] of this.activeRuns) {
      entry.abortController.abort()
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      try {
        const session = await this.adapter?.getSession?.(entry.scope, sessionId)
        if (session && session.bgStatus === 'running') {
          session.bgStatus = 'interrupted'
          session.finishedAt = Date.now()
          await this.saveSessionFields(entry.scope, session)
          log.info('Marked running BG session as interrupted on shutdown:', sessionId)
        }
      } catch (err) {
        log.warn('Failed to mark BG session as interrupted:', sessionId, err)
      }
    }
    this.activeRuns.clear()
    observerRegistry.clear()
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    log.info('BackgroundSessionManager shut down')
  }

  /**
   * 触发并执行一个 BG Session（异步，立即返回 sessionId + promise）
   */
  async trigger(
    scope: string,
    payload: BgTriggerPayload,
    meta: Partial<BgSessionMeta>,
    options?: { signal?: AbortSignal }
  ): Promise<{ sessionId: string; promise: Promise<BgRunResult> }> {
    if (!this.adapter?.createSession || !this.adapter?.chat) {
      throw new Error('Agent adapter not available or missing createSession/chat')
    }

    this.checkConcurrencyLimits(meta)

    const session = await this.adapter.createSession(scope)
    const sessionId = session.id
    const now = Date.now()

    const rawMeta: BgSessionMeta = {
      triggerType: meta.triggerType ?? 'api',
      ...meta,
      memoryPolicy: { ...DEFAULT_BG_MEMORY_POLICY, ...meta.memoryPolicy }
    }
    const mergedMeta = Object.fromEntries(
      Object.entries(rawMeta).filter(([, v]) => v !== undefined)
    ) as BgSessionMeta
    const timeoutMs = mergedMeta.timeoutMs ?? DEFAULT_TIMEOUT_MS

    Object.assign(session, {
      kind: 'background' as const,
      bgMeta: mergedMeta,
      bgStatus: 'pending' as BgStatus,
      startedAt: now
    })
    await this.saveSessionFields(scope, session)

    void emit('agent:session.created', {
      scope,
      sessionId,
      actor: { type: 'system' as const, source: 'bg-session' }
    })

    const abortController = new AbortController()
    if (options?.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    let resolveRun!: (result: BgRunResult) => void
    const promise = new Promise<BgRunResult>((resolve) => {
      resolveRun = resolve
    })

    const timeoutTimer = setTimeout(() => {
      this.handleTimeout(scope, sessionId)
    }, timeoutMs)

    const entry: ActiveRunEntry = {
      sessionId,
      scope,
      abortController,
      startedAt: now,
      timeoutTimer,
      resolve: resolveRun
    }
    this.activeRuns.set(sessionId, entry)

    this.executeRun(scope, sessionId, payload, mergedMeta, abortController.signal).catch((err) => {
      log.error('BG session execution error:', sessionId, err)
    })

    return { sessionId, promise }
  }

  /**
   * 同步执行并等待结果
   */
  async triggerSync(
    scope: string,
    payload: BgTriggerPayload,
    meta: Partial<BgSessionMeta>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<BgRunResult> {
    const tm = options?.timeoutMs ?? meta.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const { promise } = await this.trigger(
      scope,
      payload,
      { ...meta, timeoutMs: tm },
      { signal: options?.signal }
    )
    return promise
  }

  /**
   * 取消运行中的 BG Session
   */
  async cancel(scope: string, sessionId: string): Promise<void> {
    const entry = this.activeRuns.get(sessionId)
    if (entry) {
      entry.abortController.abort()
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
    }

    const session = await this.adapter?.getSession?.(scope, sessionId)
    if (session && session.kind === 'background' && session.bgStatus === 'running') {
      session.bgStatus = 'cancelled'
      session.finishedAt = Date.now()
      await this.saveSessionFields(scope, session)
    }

    if (entry) {
      const durationMs = Date.now() - entry.startedAt
      entry.resolve({ sessionId, status: 'cancelled', output: '', durationMs })
      this.activeRuns.delete(sessionId)
    }

    observerRegistry.endSession(sessionId, { bgStatus: 'cancelled' })

    void emit('bg:session.cancelled', { scope, sessionId })
    log.info('BG session cancelled:', sessionId)
  }

  /** 检查某个 session 是否正在后台运行 */
  isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId)
  }

  /** 获取活跃运行数量 */
  get activeCount(): number {
    return this.activeRuns.size
  }

  // ─── 内部方法 ───

  private checkConcurrencyLimits(meta: Partial<BgSessionMeta>): void {
    if (this.activeRuns.size >= this.limits.maxGlobal) {
      throw new Error(`BG session global concurrency limit reached (${this.limits.maxGlobal})`)
    }
    if (meta.parentSessionId) {
      const parentChildren = [...this.activeRuns.values()].filter(
        (e) => e.sessionId !== meta.parentSessionId
      )
      const parentCount = parentChildren.length
      if (parentCount >= this.limits.maxPerParent) {
        throw new Error(
          `BG session per-parent concurrency limit reached (${this.limits.maxPerParent})`
        )
      }
    }
    if ((meta.depth ?? 0) >= this.limits.maxDepth) {
      throw new Error(`BG session max nesting depth reached (${this.limits.maxDepth})`)
    }
  }

  private async executeRun(
    scope: string,
    sessionId: string,
    payload: BgTriggerPayload,
    meta: BgSessionMeta,
    signal: AbortSignal
  ): Promise<void> {
    observerRegistry.startSession(sessionId)
    const chunkHandler = (chunk: import('../../adapters/interfaces').LLMStreamChunk) => {
      observerRegistry.dispatch(sessionId, chunk)
    }

    try {
      const session = await this.adapter!.getSession!(scope, sessionId)
      if (!session) throw new Error('Session not found after creation')

      session.bgStatus = 'running'
      await this.saveSessionFields(scope, session)

      const systemPreamble = buildBgSystemPreamble(payload, meta)
      const memPolicy = meta.memoryPolicy ?? DEFAULT_BG_MEMORY_POLICY

      await this.chatService!.execute(
        this.adapter!,
        {
          scope,
          sessionId,
          content: payload.prompt,
          model: meta.model,
          signal,
          includeScopeContext: true,
          systemPreamble,
          skipCheckpoint: true,
          skipSummary: memPolicy.skipConversationSummary !== false,
          skipPerRoundExtract: memPolicy.skipPerRoundExtract !== false,
          skipNarrativeBatchExtract: memPolicy.skipNarrativeBatchExtract !== false,
          skipSlashCommands: true,
          skipChatStatus: true,
          actor: { type: 'system', source: 'bg-session' }
        },
        chunkHandler
      )

      // 结果守卫
      const updatedSession = await this.adapter!.getSession!(scope, sessionId)
      if (!updatedSession) return

      if (needsResultGuard(updatedSession)) {
        log.info('BG session result guard triggered, sending reminder:', sessionId)
        await this.chatService!.execute(
          this.adapter!,
          {
            scope,
            sessionId,
            content: getResultGuardPrompt(updatedSession),
            model: meta.model,
            signal,
            includeScopeContext: false,
            skipCheckpoint: true,
            skipSummary: true,
            skipMemory: true,
            skipSlashCommands: true,
            skipChatStatus: true,
            actor: { type: 'system', source: 'bg-session:guard' }
          },
          chunkHandler
        )

        const finalSession = await this.adapter!.getSession!(scope, sessionId)
        if (finalSession && needsResultGuard(finalSession)) {
          const fallback = extractFallbackResult(finalSession)
          finalSession.bgResult = fallback
          finalSession.bgStatus = 'completed'
          finalSession.finishedAt = Date.now()
          await this.saveSessionFields(scope, finalSession)
          log.info('BG session fallback result applied:', sessionId)
        }
      }

      // ── 结构化输出 Schema 验证 ──
      if (payload.outputSchema) {
        await this.validateOutputSchema(scope, sessionId, payload, meta, signal, chunkHandler)
      }

      this.completeRun(scope, sessionId)
    } catch (err: unknown) {
      if (signal.aborted) return
      const errMsg = err instanceof Error ? err.message : String(err)
      const errorDetail = err instanceof Error ? err.stack : undefined
      log.error('BG session execution failed:', sessionId, errMsg)
      await this.failRun(scope, sessionId, errMsg, errorDetail)
    }
  }

  /**
   * 验证 bgResult 是否符合 outputSchema，不通过则注入修正提示重试
   */
  private async validateOutputSchema(
    scope: string,
    sessionId: string,
    payload: BgTriggerPayload,
    meta: BgSessionMeta,
    signal: AbortSignal,
    chunkHandler: (chunk: import('../../adapters/interfaces').LLMStreamChunk) => void
  ): Promise<void> {
    const maxRetries = payload.maxSchemaRetries ?? 2
    const schema = payload.outputSchema
    if (!schema) return

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const session = await this.adapter!.getSession!(scope, sessionId)
      if (!session?.bgStructuredData) break

      const validationError = validateJsonSchema(session.bgStructuredData, schema)
      if (!validationError) {
        log.info('BG session schema validation passed: %s (attempt %d)', sessionId, attempt)
        return
      }

      log.info(
        'BG session schema validation failed (attempt %d/%d): %s — %s',
        attempt + 1,
        maxRetries,
        sessionId,
        validationError
      )

      const correctionPrompt =
        `你之前提交的 structured_data 不符合要求的 JSON Schema。\n\n` +
        `验证错误：${validationError}\n\n` +
        `要求的 Schema：\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\n` +
        `请重新调用 prizm_set_result 工具，确保 structured_data 参数严格符合上述 Schema。`

      await this.chatService!.execute(
        this.adapter!,
        {
          scope,
          sessionId,
          content: correctionPrompt,
          model: meta.model,
          signal,
          includeScopeContext: false,
          skipCheckpoint: true,
          skipSummary: true,
          skipMemory: true,
          skipSlashCommands: true,
          skipChatStatus: true,
          actor: { type: 'system', source: 'bg-session:schema-retry' }
        },
        chunkHandler
      )
    }
  }

  private async completeRun(scope: string, sessionId: string): Promise<void> {
    const entry = this.activeRuns.get(sessionId)
    const session = await this.adapter?.getSession?.(scope, sessionId)

    if (session) {
      if (session.bgStatus === 'running') {
        session.bgStatus = 'completed'
      }
      if (!session.finishedAt) {
        session.finishedAt = Date.now()
      }
      await this.saveSessionFields(scope, session)
    }

    const durationMs = entry ? Date.now() - entry.startedAt : 0
    const result: BgRunResult = {
      sessionId,
      status: session?.bgStatus === 'completed' ? 'success' : 'failed',
      output: session?.bgResult ?? '',
      structuredData: session?.bgStructuredData,
      artifacts: session?.bgArtifacts,
      durationMs
    }

    if (entry) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      entry.resolve(result)
      this.activeRuns.delete(sessionId)
    }

    observerRegistry.endSession(sessionId, {
      bgStatus: session?.bgStatus ?? 'completed',
      bgResult: session?.bgResult
    })

    void emit('bg:session.completed', {
      scope,
      sessionId,
      result: result.output,
      durationMs
    })
    log.info('BG session completed:', sessionId, `(${durationMs}ms)`)
  }

  private async failRun(
    scope: string,
    sessionId: string,
    error: string,
    errorDetail?: string
  ): Promise<void> {
    const entry = this.activeRuns.get(sessionId)
    const session = await this.adapter?.getSession?.(scope, sessionId)

    if (session) {
      session.bgStatus = 'failed'
      session.bgResult = `错误：${error}`
      session.finishedAt = Date.now()
      await this.saveSessionFields(scope, session)
    }

    const durationMs = entry ? Date.now() - entry.startedAt : 0
    const result: BgRunResult = {
      sessionId,
      status: 'failed',
      output: `错误：${error}`,
      durationMs,
      ...(errorDetail ? { errorDetail } : {})
    }

    if (entry) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      entry.resolve(result)
      this.activeRuns.delete(sessionId)
    }

    observerRegistry.endSession(sessionId, { bgStatus: 'failed', bgResult: `错误：${error}` })

    void emit('bg:session.failed', { scope, sessionId, error, durationMs })
    log.info('BG session failed:', sessionId, error)
  }

  private async handleTimeout(scope: string, sessionId: string): Promise<void> {
    const entry = this.activeRuns.get(sessionId)
    if (!entry) return

    entry.abortController.abort()

    const session = await this.adapter?.getSession?.(scope, sessionId)
    const timeoutMs = session?.bgMeta?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (session) {
      session.bgStatus = 'timeout'
      session.finishedAt = Date.now()
      await this.saveSessionFields(scope, session)
    }

    const durationMs = Date.now() - entry.startedAt
    entry.resolve({
      sessionId,
      status: 'timeout',
      output: `超时（${timeoutMs}ms）`,
      durationMs
    })
    this.activeRuns.delete(sessionId)

    observerRegistry.endSession(sessionId, { bgStatus: 'timeout' })

    void emit('bg:session.timeout', { scope, sessionId, timeoutMs })
    log.info('BG session timed out:', sessionId)
  }

  private async saveSessionFields(scope: string, session: AgentSession): Promise<void> {
    if (!this.adapter?.updateSession) {
      log.warn('updateSession not available, BG session state may not persist')
      return
    }
    await this.adapter.updateSession(scope, session.id, {
      kind: session.kind,
      bgMeta: session.bgMeta,
      bgStatus: session.bgStatus,
      bgResult: session.bgResult,
      bgStructuredData: session.bgStructuredData,
      bgArtifacts: session.bgArtifacts,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt
    })
  }

  /** 清理 activeRuns 中已达终态的条目 */
  private async cleanup(): Promise<void> {
    const TERMINAL: BgStatus[] = ['completed', 'failed', 'timeout', 'cancelled', 'interrupted']
    for (const [sessionId, entry] of this.activeRuns) {
      const session = await this.adapter?.getSession?.(entry.scope, sessionId)
      if (!session) {
        this.activeRuns.delete(sessionId)
        if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
        continue
      }
      if (TERMINAL.includes(session.bgStatus as BgStatus)) {
        this.activeRuns.delete(sessionId)
        if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      }
    }
  }
}

export const bgSessionManager = new BackgroundSessionManager()
