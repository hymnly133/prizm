/**
 * 资源锁定管理器 - 类型定义
 * 支持文档签出/签入和待办列表领取的独占锁机制
 */

/** 可锁定的资源类型 */
export type LockableResourceType = 'document' | 'todo_list'

/** 资源锁记录 */
export interface ResourceLock {
  id: string
  resourceType: LockableResourceType
  resourceId: string
  scope: string
  /** 持有锁的 agent session ID */
  sessionId: string
  /** 单调递增 fencing token，防止过期锁持有者脏写 */
  fenceToken: number
  /** 签出理由 */
  reason?: string
  /** 锁获取时间 (ms) */
  acquiredAt: number
  /** 最后心跳时间 (ms) */
  lastHeartbeat: number
  /** TTL 毫秒，超过 lastHeartbeat + ttlMs 视为过期 */
  ttlMs: number
  /** 附加元数据 JSON（如 todo claim 的 activeTodoIds） */
  metadata?: string
}

/** 资源读取日志 */
export interface ResourceReadRecord {
  id: string
  scope: string
  sessionId: string
  resourceType: LockableResourceType
  resourceId: string
  /** 读取时的资源版本（文档 updatedAt 或版本号） */
  readVersion: number
  readAt: number
}

/** 获取锁的结果 */
export interface AcquireLockResult {
  success: boolean
  lock?: ResourceLock
  /** 获取失败时，当前持有锁的信息 */
  heldBy?: { sessionId: string; acquiredAt: number; reason?: string }
}

/** 资源状态查询结果 */
export interface ResourceStatus {
  resourceType: LockableResourceType
  resourceId: string
  scope: string
  /** 当前锁（null 表示未锁定） */
  lock: ResourceLock | null
  /** 最近读取记录 */
  recentReads: ResourceReadRecord[]
}

/** 默认锁 TTL：5 分钟 */
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000
