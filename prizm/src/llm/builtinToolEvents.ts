/**
 * 内置工具事件总线
 * builtinTools 执行文件操作后通过此总线通知外部（如 WebSocket 广播）
 * 避免 builtinTools 直接依赖 WebSocket 层
 */
import { EventEmitter } from 'events'

export interface BuiltinToolFileEvent {
  eventType: 'file:created' | 'file:moved' | 'file:deleted'
  scope: string
  relativePath: string
  /** 移动操作时的源路径 */
  fromPath?: string
}

class BuiltinToolEventBus extends EventEmitter {
  emitFileEvent(event: BuiltinToolFileEvent): void {
    this.emit('file', event)
  }

  onFileEvent(handler: (event: BuiltinToolFileEvent) => void): () => void {
    this.on('file', handler)
    return () => {
      this.off('file', handler)
    }
  }
}

export const builtinToolEvents = new BuiltinToolEventBus()
