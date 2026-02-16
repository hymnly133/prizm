/**
 * InteractManager - 管理工具执行过程中需要用户交互的阻塞请求
 *
 * 当工具执行需要用户确认（如文件访问越界、敏感操作等）时，
 * adapter 通过 SSE 向客户端发送交互请求，并在此处等待用户响应。
 * 客户端确认/拒绝后，route 层调用 resolve 方法解除阻塞。
 *
 * 设计参考：
 * - Claude Agent SDK 的 canUseTool 阻塞回调
 * - LlamaIndex 的 InputRequiredEvent + HumanResponseEvent
 */

import { createLogger } from '../logger'
import { genUniqueId } from '../id'

const log = createLogger('InteractManager')

/** 交互请求的状态 */
export type InteractStatus = 'pending' | 'approved' | 'denied' | 'timeout'

/** 交互请求描述 */
export interface InteractRequest {
  /** 唯一请求 ID */
  requestId: string
  /** 关联的工具调用 ID */
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 需要授权的路径列表 */
  paths: string[]
  /** 会话 ID */
  sessionId: string
  /** scope */
  scope: string
  /** 创建时间 */
  createdAt: number
}

/** 交互响应 */
export interface InteractResponse {
  requestId: string
  approved: boolean
  /** 用户批准的路径（可能是 paths 的子集） */
  grantedPaths?: string[]
}

/** 内部挂起项 */
interface PendingInteract {
  request: InteractRequest
  resolve: (response: InteractResponse) => void
  timer: ReturnType<typeof setTimeout>
}

/** 默认交互超时（毫秒）：60 秒 */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * 全局交互管理器（单例），按 scope:sessionId 隔离
 */
class InteractManagerImpl {
  private pending = new Map<string, PendingInteract>()

  /**
   * 创建交互请求并等待用户响应
   * 返回 Promise<InteractResponse>，resolve 时表示用户已做出选择
   */
  createRequest(
    sessionId: string,
    scope: string,
    toolCallId: string,
    toolName: string,
    paths: string[],
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): { request: InteractRequest; promise: Promise<InteractResponse> } {
    const requestId = genUniqueId()
    const request: InteractRequest = {
      requestId,
      toolCallId,
      toolName,
      paths,
      sessionId,
      scope,
      createdAt: Date.now()
    }

    const promise = new Promise<InteractResponse>((resolve) => {
      const timer = setTimeout(() => {
        log.info('Interact request timed out: %s (tool=%s)', requestId, toolName)
        this.pending.delete(requestId)
        resolve({ requestId, approved: false })
      }, timeoutMs)

      this.pending.set(requestId, { request, resolve, timer })
    })

    log.info(
      'Created interact request: %s (tool=%s, paths=%s)',
      requestId,
      toolName,
      paths.join(', ')
    )

    return { request, promise }
  }

  /**
   * 解决交互请求（由 route 层在收到客户端 POST 时调用）
   * @returns true 如果找到并解决了请求，false 如果请求不存在或已超时
   */
  resolveRequest(requestId: string, approved: boolean, grantedPaths?: string[]): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) {
      log.warn('Interact request not found or already resolved: %s', requestId)
      return false
    }

    clearTimeout(entry.timer)
    this.pending.delete(requestId)

    log.info(
      'Interact request %s: %s (tool=%s)',
      approved ? 'approved' : 'denied',
      requestId,
      entry.request.toolName
    )

    entry.resolve({
      requestId,
      approved,
      grantedPaths: approved ? grantedPaths ?? entry.request.paths : undefined
    })
    return true
  }

  /**
   * 取消某个会话的所有待处理交互（会话删除、连接断开时调用）
   */
  cancelSession(sessionId: string, scope: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.request.sessionId === sessionId && entry.request.scope === scope) {
        clearTimeout(entry.timer)
        entry.resolve({ requestId: id, approved: false })
        this.pending.delete(id)
        log.info('Cancelled interact request %s due to session cleanup', id)
      }
    }
  }

  /**
   * 获取某个会话的所有待处理交互请求
   */
  getPendingRequests(sessionId: string, scope: string): InteractRequest[] {
    const result: InteractRequest[] = []
    for (const entry of this.pending.values()) {
      if (entry.request.sessionId === sessionId && entry.request.scope === scope) {
        result.push(entry.request)
      }
    }
    return result
  }

  /** 获取特定请求 */
  getRequest(requestId: string): InteractRequest | undefined {
    return this.pending.get(requestId)?.request
  }
}

/** 全局单例 */
export const interactManager = new InteractManagerImpl()
