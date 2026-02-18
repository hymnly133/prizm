/**
 * Service Layer 业务异常
 * 调用方根据异常类型翻译为 HTTP 状态码或工具错误文本
 */

/** 资源被锁定（Agent checkout / claim） */
export class ResourceLockedException extends Error {
  readonly statusCode = 423
  readonly lockSessionId?: string

  constructor(message: string, lockSessionId?: string) {
    super(message)
    this.name = 'ResourceLockedException'
    this.lockSessionId = lockSessionId
  }
}

/** 资源未找到 */
export class ResourceNotFoundException extends Error {
  readonly statusCode = 404

  constructor(message: string) {
    super(message)
    this.name = 'ResourceNotFoundException'
  }
}

/** 参数校验失败 */
export class ValidationError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
