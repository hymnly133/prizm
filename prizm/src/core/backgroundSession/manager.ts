/**
 * BackgroundSessionManager
 *
 * BG Session 的核心管理模块，负责：
 * - 触发并执行 BG Session（异步/同步）
 * - 超时控制与取消
 * - 结果守卫（检查 prizm_set_result 是否被调用）
 * - 活跃运行追踪
 * - 自动清理
 */

import type { AgentSession, BgSessionMeta, BgStatus, SessionMemoryPolicy } from '@prizm/shared'
import type { IAgentAdapter } from '../../adapters/interfaces'
import type {
  ActiveRunEntry,
  BgConcurrencyLimits,
  BgListFilter,
  BgRunResult,
  BgTriggerPayload
} from './types'
import { needsResultGuard, RESULT_GUARD_PROMPT, extractFallbackResult } from './resultGuard'
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
  private activeRuns = new Map<string, ActiveRunEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private limits: BgConcurrencyLimits = {
    maxPerParent: 5,
    maxGlobal: 10,
    maxDepth: 2
  }

  init(adapter: IAgentAdapter | undefined, limits?: Partial<BgConcurrencyLimits>): void {
    this.adapter = adapter
    if (limits) Object.assign(this.limits, limits)
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
    log.info('BackgroundSessionManager initialized')
  }

  shutdown(): void {
    for (const [, entry] of this.activeRuns) {
      entry.abortController.abort()
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
    }
    this.activeRuns.clear()
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

    const mergedMeta: BgSessionMeta = {
      triggerType: meta.triggerType ?? 'api',
      ...meta,
      memoryPolicy: { ...DEFAULT_BG_MEMORY_POLICY, ...meta.memoryPolicy }
    }
    const timeoutMs = mergedMeta.timeoutMs ?? DEFAULT_TIMEOUT_MS

    Object.assign(session, {
      kind: 'background' as const,
      bgMeta: mergedMeta,
      bgStatus: 'pending' as BgStatus,
      startedAt: now
    })
    await this.saveSessionFields(scope, session)

    void emit('bg:session.triggered', {
      scope,
      sessionId,
      triggerType: mergedMeta.triggerType,
      parentSessionId: mergedMeta.parentSessionId,
      label: mergedMeta.label
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

    this.executeRun(scope, sessionId, payload, mergedMeta, abortController.signal).catch(
      (err) => {
        log.error('BG session execution error:', sessionId, err)
      }
    )

    return { sessionId, promise }
  }

  /**
   * 同步执行并等待结果
   */
  async triggerSync(
    scope: string,
    payload: BgTriggerPayload,
    meta: Partial<BgSessionMeta>,
    options?: { timeoutMs?: number }
  ): Promise<BgRunResult> {
    const tm = options?.timeoutMs ?? meta.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const { promise } = await this.trigger(scope, payload, { ...meta, timeoutMs: tm })
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

    void emit('bg:session.cancelled', { scope, sessionId })
    log.info('BG session cancelled:', sessionId)
  }

  /**
   * 列出 BG Sessions（支持按状态/父会话筛选）
   */
  async list(scope: string, filter?: BgListFilter): Promise<AgentSession[]> {
    const sessions = await this.adapter?.listSessions?.(scope)
    if (!sessions) return []
    return sessions.filter((s) => {
      if (s.kind !== 'background') return false
      if (filter?.bgStatus && s.bgStatus !== filter.bgStatus) return false
      if (filter?.triggerType && s.bgMeta?.triggerType !== filter.triggerType) return false
      if (filter?.parentSessionId && s.bgMeta?.parentSessionId !== filter.parentSessionId)
        return false
      if (filter?.label && s.bgMeta?.label !== filter.label) return false
      return true
    })
  }

  /**
   * 获取 BG 运行结果
   */
  async getResult(scope: string, sessionId: string): Promise<BgRunResult | null> {
    const session = await this.adapter?.getSession?.(scope, sessionId)
    if (!session || session.kind !== 'background') return null
    if (!session.bgStatus || session.bgStatus === 'pending' || session.bgStatus === 'running') {
      return null
    }
    const durationMs = (session.finishedAt ?? Date.now()) - (session.startedAt ?? session.createdAt)
    const statusMap: Record<string, BgRunResult['status']> = {
      completed: 'success',
      failed: 'failed',
      timeout: 'timeout',
      cancelled: 'cancelled'
    }
    return {
      sessionId,
      status: statusMap[session.bgStatus] ?? 'failed',
      output: session.bgResult ?? '',
      durationMs
    }
  }

  /** 获取后台概览统计 */
  async getSummary(scope: string): Promise<{
    active: number
    completed: number
    failed: number
    timeout: number
    cancelled: number
  }> {
    const sessions = await this.adapter?.listSessions?.(scope)
    const bg = (sessions ?? []).filter((s) => s.kind === 'background')
    return {
      active: bg.filter((s) => s.bgStatus === 'running' || s.bgStatus === 'pending').length,
      completed: bg.filter((s) => s.bgStatus === 'completed').length,
      failed: bg.filter((s) => s.bgStatus === 'failed').length,
      timeout: bg.filter((s) => s.bgStatus === 'timeout').length,
      cancelled: bg.filter((s) => s.bgStatus === 'cancelled').length
    }
  }

  /** 批量取消运行中的 BG Sessions */
  async batchCancel(scope: string, sessionIds?: string[]): Promise<number> {
    const targets = sessionIds
      ? sessionIds
      : [...this.activeRuns.values()]
          .filter((e) => e.scope === scope)
          .map((e) => e.sessionId)
    let count = 0
    for (const id of targets) {
      try {
        await this.cancel(scope, id)
        count++
      } catch {
        log.warn('Failed to cancel BG session:', id)
      }
    }
    return count
  }

  /** 清理已完成且标记 autoCleanup 的会话 */
  async cleanup(): Promise<void> {
    // 清理已完成且 autoCleanup=true 的会话（需遍历所有 scope，但此处仅处理内存追踪）
    for (const [sessionId, entry] of this.activeRuns) {
      const session = await this.adapter?.getSession?.(entry.scope, sessionId)
      if (!session) {
        this.activeRuns.delete(sessionId)
        if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
        continue
      }
      const terminal = ['completed', 'failed', 'timeout', 'cancelled']
      if (terminal.includes(session.bgStatus ?? '')) {
        this.activeRuns.delete(sessionId)
        if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      }
    }
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
      throw new Error(
        `BG session global concurrency limit reached (${this.limits.maxGlobal})`
      )
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
      throw new Error(
        `BG session max nesting depth reached (${this.limits.maxDepth})`
      )
    }
  }

  private async executeRun(
    scope: string,
    sessionId: string,
    payload: BgTriggerPayload,
    meta: BgSessionMeta,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const session = await this.adapter!.getSession!(scope, sessionId)
      if (!session) throw new Error('Session not found after creation')

      session.bgStatus = 'running'
      await this.saveSessionFields(scope, session)
      void emit('bg:session.started', { scope, sessionId })

      const messages = this.buildMessages(payload, meta)

      const chatOptions = {
        model: meta.model,
        signal,
        includeScopeContext: true,
        grantedPaths: session.grantedPaths
      }

      const stream = this.adapter!.chat!(scope, sessionId, messages, chatOptions)
      for await (const _chunk of stream) {
        if (signal.aborted) break
      }

      const updatedSession = await this.adapter!.getSession!(scope, sessionId)
      if (!updatedSession) return

      if (needsResultGuard(updatedSession)) {
        log.info('BG session result guard triggered, sending reminder:', sessionId)
        const guardMessages = [{ role: 'system', content: RESULT_GUARD_PROMPT }]
        const guardStream = this.adapter!.chat!(scope, sessionId, guardMessages, chatOptions)
        for await (const _chunk of guardStream) {
          if (signal.aborted) break
        }

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

      this.completeRun(scope, sessionId)
    } catch (err: unknown) {
      if (signal.aborted) return
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error('BG session execution failed:', sessionId, errMsg)
      await this.failRun(scope, sessionId, errMsg)
    }
  }

  private buildMessages(
    payload: BgTriggerPayload,
    meta: BgSessionMeta
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []

    let systemContent = ''
    if (payload.systemInstructions) {
      systemContent += payload.systemInstructions + '\n\n'
    }
    if (payload.context && Object.keys(payload.context).length > 0) {
      systemContent += '## 上下文数据\n```json\n' + JSON.stringify(payload.context, null, 2) + '\n```\n\n'
    }
    if (payload.expectedOutputFormat) {
      systemContent +=
        '## 输出格式要求\n' +
        payload.expectedOutputFormat +
        '\n\n' +
        '**重要**：任务完成后你必须调用 `prizm_set_result` 工具提交结果。\n'
    } else {
      systemContent +=
        '**重要**：任务完成后你必须调用 `prizm_set_result` 工具提交结果。\n'
    }
    if (meta.label) {
      systemContent += `\n任务标签：${meta.label}\n`
    }

    if (systemContent.trim()) {
      messages.push({ role: 'system', content: systemContent.trim() })
    }
    messages.push({ role: 'user', content: payload.prompt })
    return messages
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
      durationMs
    }

    if (entry) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      entry.resolve(result)
      this.activeRuns.delete(sessionId)
    }

    void emit('bg:session.completed', {
      scope,
      sessionId,
      result: result.output,
      durationMs
    })
    log.info('BG session completed:', sessionId, `(${durationMs}ms)`)
  }

  private async failRun(scope: string, sessionId: string, error: string): Promise<void> {
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
      durationMs
    }

    if (entry) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
      entry.resolve(result)
      this.activeRuns.delete(sessionId)
    }

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
      startedAt: session.startedAt,
      finishedAt: session.finishedAt
    })
  }
}

export const bgSessionManager = new BackgroundSessionManager()
