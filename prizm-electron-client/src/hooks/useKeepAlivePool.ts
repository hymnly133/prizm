/**
 * useKeepAlivePool — LRU 策略的会话 KeepAlive 池
 *
 * 追踪最近访问的 N 个会话 ID，配合 CSS display 切换实现 O(1) 会话切换。
 * 被 AgentPage 和 AgentPane 共享。
 */
import { useMemo, useRef } from 'react'
import type { EnrichedSession } from '@prizm/client-core'

export function useKeepAlivePool(
  currentSessionId: string | undefined,
  sessions: EnrichedSession[],
  maxKeepAlive: number = 3
): string[] {
  const alivePoolRef = useRef<string[]>([])

  return useMemo(() => {
    const validIds = new Set(sessions.map((s) => s.id))
    let pool = alivePoolRef.current.filter((id) => validIds.has(id))

    if (currentSessionId && validIds.has(currentSessionId)) {
      if (pool[0] !== currentSessionId) {
        const isHit = pool.includes(currentSessionId)
        pool = [currentSessionId, ...pool.filter((id) => id !== currentSessionId)].slice(
          0,
          maxKeepAlive
        )
        console.debug(
          `[perf] KeepAlive pool update: %c${isHit ? 'HIT' : 'MISS (new mount)'}`,
          isHit ? 'color:#4CAF50;font-weight:bold' : 'color:#FF5722;font-weight:bold',
          { active: currentSessionId.slice(0, 8), pool: pool.map((id) => id.slice(0, 8)) }
        )
      }
    }

    alivePoolRef.current = pool
    return pool
  }, [currentSessionId, sessions, maxKeepAlive])
}
