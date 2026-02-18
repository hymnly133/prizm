/**
 * Prizm Server 类型定义
 * 领域类型从 @prizm/shared 导入，仅保留 Server 专用类型
 */

import type {
  StickyNote,
  StickyNoteFileRef,
  TodoList,
  TodoItem,
  TodoItemStatus,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
  PomodoroSession,
  ClipboardItem,
  ClipboardItemType,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  AgentSession,
  AgentMessage,
  MessagePart,
  MessageUsage,
  SessionCheckpoint,
  CheckpointFileChange,
  SessionKind,
  BgTriggerType,
  BgStatus,
  BgSessionMeta,
  SessionMemoryPolicy,
  ScopeRefKind,
  ScopeTopLevelKind,
  ScopeRefItem,
  ScopeTopLevelItem,
  ScopeStats,
  ItemProvision,
  SessionContextState,
  ScopeActivityRecord,
  ScopeActivityAction,
  ScopeActivityItemKind,
  TokenUsageRecord,
  TokenUsageCategory,
  FileEntry,
  FileReadResult
} from '@prizm/shared'

// 重导出，供 routes、adapters 等使用
export type {
  /** @deprecated 已合并到 Document，仅用于迁移 */
  StickyNote,
  /** @deprecated 已合并到 Document，仅用于迁移 */
  StickyNoteFileRef,
  TodoList,
  TodoItem,
  TodoItemStatus,
  CreateTodoItemPayload,
  UpdateTodoItemPayload,
  /** @deprecated 番茄钟已移除，仅用于迁移 */
  PomodoroSession,
  ClipboardItem,
  ClipboardItemType,
  Document,
  CreateDocumentPayload,
  UpdateDocumentPayload,
  AgentSession,
  AgentMessage,
  MessagePart,
  MessageUsage,
  SessionCheckpoint,
  CheckpointFileChange,
  SessionKind,
  BgTriggerType,
  BgStatus,
  BgSessionMeta,
  SessionMemoryPolicy,
  ScopeRefKind,
  ScopeTopLevelKind,
  ScopeRefItem,
  ScopeTopLevelItem,
  ScopeStats,
  ItemProvision,
  SessionContextState,
  ScopeActivityRecord,
  ScopeActivityAction,
  ScopeActivityItemKind,
  TokenUsageRecord,
  TokenUsageCategory,
  FileEntry,
  FileReadResult
}

// ============ Scope 与 Auth 类型（Server 专用） ============

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
  /** 数据目录，默认从 PRIZM_DATA_DIR 或 .prizm-data */
  dataDir?: string
  enableCors?: boolean
  /** 是否启用鉴权，默认 true；设为 false 时行为与旧版一致 */
  authEnabled?: boolean
  /** 是否启用 WebSocket 服务器，默认 true */
  enableWebSocket?: boolean
  /** WebSocket 路径，默认 '/ws' */
  websocketPath?: string
}
