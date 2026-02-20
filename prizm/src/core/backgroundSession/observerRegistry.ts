/**
 * BG Session Observer Registry
 *
 * 管理 BG Session 的实时流式观察：
 * - 缓存执行期间的所有 LLMStreamChunk，支持中途加入回放
 * - 按需注册/注销观察者，无观察者时零开销
 * - session 结束后保留缓存 30s，供迟到的观察者回放
 */

import type { LLMStreamChunk } from '../../adapters/interfaces'
import { createLogger } from '../../logger'

const log = createLogger('ObserverRegistry')

const BUFFER_RETAIN_MS = 30_000

export interface ObserverCallbacks {
  onChunk: (chunk: LLMStreamChunk) => void
  onDone: (info: { bgStatus: string; bgResult?: string }) => void
}

interface SessionObserverState {
  observers: Set<ObserverCallbacks>
  buffer: LLMStreamChunk[]
  doneInfo: { bgStatus: string; bgResult?: string } | null
  retainTimer: ReturnType<typeof setTimeout> | null
}

class ObserverRegistry {
  private sessions = new Map<string, SessionObserverState>()

  /** 开始追踪一个 BG session 的流式输出 */
  startSession(sessionId: string): void {
    const existing = this.sessions.get(sessionId)
    if (existing?.retainTimer) {
      clearTimeout(existing.retainTimer)
      existing.retainTimer = null
    }
    this.sessions.set(sessionId, {
      observers: new Set(),
      buffer: [],
      doneInfo: null,
      retainTimer: null
    })
  }

  /**
   * 标记 session 执行结束，通知所有观察者并启动缓存保留计时
   */
  endSession(sessionId: string, info: { bgStatus: string; bgResult?: string }): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.doneInfo = info
    for (const obs of state.observers) {
      try { obs.onDone(info) } catch { /* ignore */ }
    }
    state.observers.clear()
    state.retainTimer = setTimeout(() => {
      this.sessions.delete(sessionId)
    }, BUFFER_RETAIN_MS)
  }

  /**
   * 注册观察者。先回放缓存的 chunks，再接收实时 chunks。
   * 若 session 已结束，回放后立即触发 onDone。
   * @returns 是否成功注册（session 不存在时返回 false）
   */
  register(sessionId: string, callbacks: ObserverCallbacks): boolean {
    const state = this.sessions.get(sessionId)
    if (!state) return false

    for (const chunk of state.buffer) {
      try { callbacks.onChunk(chunk) } catch { /* ignore */ }
    }

    if (state.doneInfo) {
      try { callbacks.onDone(state.doneInfo) } catch { /* ignore */ }
      return true
    }

    state.observers.add(callbacks)
    return true
  }

  /** 注销观察者 */
  unregister(sessionId: string, callbacks: ObserverCallbacks): void {
    this.sessions.get(sessionId)?.observers.delete(callbacks)
  }

  /**
   * 分发 chunk：缓存并转发给所有观察者。
   * 无观察者时仅一次 Map.get + buffer.push，开销极低。
   */
  dispatch(sessionId: string, chunk: LLMStreamChunk): void {
    const state = this.sessions.get(sessionId)
    if (!state || state.doneInfo) return
    state.buffer.push(chunk)
    for (const obs of state.observers) {
      try { obs.onChunk(chunk) } catch { /* ignore */ }
    }
  }

  /** 是否正在追踪此 session（含已结束但缓存保留中的） */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** session 是否仍在执行（未结束） */
  isActive(sessionId: string): boolean {
    const state = this.sessions.get(sessionId)
    return !!state && !state.doneInfo
  }

  /** 当前活跃观察者总数（调试用） */
  get totalObservers(): number {
    let count = 0
    for (const state of this.sessions.values()) count += state.observers.size
    return count
  }

  /** 清理所有状态 */
  clear(): void {
    for (const state of this.sessions.values()) {
      if (state.retainTimer) clearTimeout(state.retainTimer)
      state.observers.clear()
    }
    this.sessions.clear()
  }
}

export const observerRegistry = new ObserverRegistry()
