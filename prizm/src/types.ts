/**
 * Prizm Server 类型定义
 * 这些类型与主应用兼容，但独立定义以避免循环依赖
 */

// ============ Sticky Notes 类型 ============

export interface StickyNoteFileRef {
  path: string
}

export interface StickyNote {
  id: string
  content: string
  imageUrls?: string[]
  createdAt: number
  updatedAt: number
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

export interface StickyNoteGroup {
  id: string
  name: string
}

export interface CreateNotePayload {
  content?: string
  imageUrls?: string[]
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

export interface UpdateNotePayload {
  content?: string
  imageUrls?: string[]
  groupId?: string
  fileRefs?: StickyNoteFileRef[]
}

// ============ Scope 与 Auth 类型 ============

export type Scope = string

export interface ClientRecord {
  clientId: string
  apiKeyHash: string
  name: string
  allowedScopes: string[]
  createdAt: number
}

// ============ Server 配置 ============

export interface PrizmServerOptions {
  port?: number
  host?: string
  enableCors?: boolean
  /** 是否启用鉴权，默认 true；设为 false 时行为与旧版一致 */
  authEnabled?: boolean
  /** 是否启用 WebSocket 服务器，默认 true */
  enableWebSocket?: boolean
  /** WebSocket 路径，默认 '/ws' */
  websocketPath?: string
}
