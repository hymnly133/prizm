import { z } from 'zod'

// ── 原始数据类型 ──

export enum RawDataType {
  CONVERSATION = 'conversation',
  IMAGE = 'image',
  TEXT = 'text',
  LINK = 'link',
  NOTE = 'note',
  FILE = 'file',
  UNKNOWN = 'unknown'
}

// ── 记忆层级 ──

export enum MemoryLayer {
  USER = 'user',
  SCOPE = 'scope',
  SESSION = 'session'
}

// ── 记忆类型 ──

export enum MemoryType {
  PROFILE = 'profile',
  NARRATIVE = 'narrative',
  FORESIGHT = 'foresight',
  DOCUMENT = 'document',
  EVENT_LOG = 'event_log'
}

// ── 文档子类型 ──

export enum DocumentSubType {
  OVERVIEW = 'overview',
  FACT = 'fact',
  MIGRATION = 'migration'
}

// ── 记忆来源类型 ──

export enum MemorySourceType {
  CONVERSATION = 'conversation',
  DOCUMENT = 'document',
  COMPRESSION = 'compression',
  MANUAL = 'manual'
}

/** User 层记忆固定使用的 group_id */
export const USER_GROUP_ID = 'user'

/**
 * 默认用户 ID。当前系统为单用户模型，所有记忆归属于同一用户。
 * 所有 userId 参数均默认使用此值，外部无需显式传递。
 */
export const DEFAULT_USER_ID = 'default'

// ── 类型安全的层级→类型映射 ──

export type UserMemoryType = MemoryType.PROFILE
export type ScopeMemoryType = MemoryType.NARRATIVE | MemoryType.FORESIGHT | MemoryType.DOCUMENT
export type SessionMemoryType = MemoryType.EVENT_LOG

export const LAYER_TYPES = {
  [MemoryLayer.USER]: [MemoryType.PROFILE],
  [MemoryLayer.SCOPE]: [MemoryType.NARRATIVE, MemoryType.FORESIGHT, MemoryType.DOCUMENT],
  [MemoryLayer.SESSION]: [MemoryType.EVENT_LOG]
} as const

/** 根据 MemoryType 推导所属层级 */
export function getLayerForType(type: MemoryType): MemoryLayer {
  switch (type) {
    case MemoryType.PROFILE:
      return MemoryLayer.USER
    case MemoryType.NARRATIVE:
    case MemoryType.FORESIGHT:
    case MemoryType.DOCUMENT:
      return MemoryLayer.SCOPE
    case MemoryType.EVENT_LOG:
      return MemoryLayer.SESSION
  }
}

export enum ParentType {
  MEMCELL = 'memcell'
}

export enum RetrieveMethod {
  KEYWORD = 'keyword',
  VECTOR = 'vector',
  HYBRID = 'hybrid',
  RRF = 'rrf',
  AGENTIC = 'agentic'
}

// ── Zod Schemas & Types ──

export const BaseMemorySchema = z.object({
  id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  timestamp: z.string().optional(),
  user_id: z.string().optional(),
  group_id: z.string().optional(),
  deleted: z.boolean().default(false),
  memory_type: z.nativeEnum(MemoryType).optional(),
  embedding: z.array(z.number()).optional(),
  content: z.string().optional(),
  metadata: z.any().optional(),
  /** 记忆来源类型 */
  source_type: z.nativeEnum(MemorySourceType).optional(),
  /** 来源会话 ID */
  source_session_id: z.string().optional(),
  /** 来源轮次消息 ID */
  source_round_id: z.string().optional(),
  /** 文档子类型（仅 DOCUMENT 类型使用） */
  sub_type: z.nativeEnum(DocumentSubType).optional()
})

export type BaseMemory = z.infer<typeof BaseMemorySchema>

/** 场景：assistant=1:1 对话；group=群聊；document=文档 */
export type MemCellScene = 'assistant' | 'group' | 'document'

/**
 * 三层记忆路由上下文，告知 MemoryManager 如何按 memory_type 设定 group_id：
 * - Profile    → group_id="user"（User 层）
 * - Narrative  → group_id=scope（Scope 层）
 * - Foresight  → group_id=scope（Scope 层）
 * - Document   → group_id=scope（Scope 层）
 * - EventLog   → group_id=scope:session:sessionId（Session 层）
 */
export interface MemoryRoutingContext {
  /** 用户 ID，默认 DEFAULT_USER_ID（当前单用户模型） */
  userId?: string
  /** 数据 scope（如 "online"） */
  scope: string
  /** 当前会话 ID；document 场景可不传 */
  sessionId?: string
  /** 关联的 assistant 消息 ID，用于按轮次查询记忆增长 */
  roundMessageId?: string
  /** 跳过 Session 层抽取（每轮只抽 User/Scope，不抽 Session） */
  skipSessionExtraction?: boolean
  /** 仅抽取 Session 层（批量压缩时用，只抽 EventLog 到 session） */
  sessionOnly?: boolean
  /** 记忆来源类型 */
  sourceType?: MemorySourceType
}

export const MemCellSchema = BaseMemorySchema.extend({
  event_id: z.string().optional(),
  type: z.nativeEnum(RawDataType),
  original_data: z.any(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  text: z.string().optional(),
  /** group=跳过 Foresight/EventLog；document=仅 Narrative+EventLog */
  scene: z.enum(['assistant', 'group', 'document']).optional()
})

export type MemCell = z.infer<typeof MemCellSchema>

export const NarrativeMemorySchema = BaseMemorySchema.extend({
  content: z.string(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  embedding: z.array(z.number()).optional()
})

export type NarrativeMemory = z.infer<typeof NarrativeMemorySchema>

/** @deprecated 使用 NarrativeMemory 代替 */
export type EpisodeMemory = NarrativeMemory
/** @deprecated 使用 NarrativeMemorySchema 代替 */
export const EpisodeMemorySchema = NarrativeMemorySchema

export const ForesightSchema = BaseMemorySchema.extend({
  content: z.string(),
  valid_start: z.string().optional(),
  valid_end: z.string().optional(),
  parent_type: z.string().optional(),
  parent_id: z.string().optional(),
  embedding: z.array(z.number()).optional()
})

export type Foresight = z.infer<typeof ForesightSchema>

/**
 * Profile 记忆 Schema — 原子化事实列表。
 *
 * UnifiedExtractor 输出 `ITEM: <一句原子描述>`，同一用户的所有 ITEM 收集到 `items` 数组。
 * 每个用户只维护一条 Profile memories 行：
 * - `content` = 所有 items 用换行拼接（用于全文搜索和 embedding）
 * - `metadata.items` = 完整原子事实列表
 * - `metadata.merge_history` = 合并追踪记录
 */
export const ProfileMemorySchema = BaseMemorySchema.extend({
  /** 原子化描述列表（每条为一个独立的持久性画像事实，包括称呼偏好） */
  items: z.array(z.string()).optional()
})

export type ProfileMemory = z.infer<typeof ProfileMemorySchema>

export const EventLogSchema = BaseMemorySchema.extend({
  content: z.string(),
  event_type: z.string().optional(),
  embedding: z.array(z.number()).optional()
})

export type EventLog = z.infer<typeof EventLogSchema>

export const DocumentMemorySchema = BaseMemorySchema.extend({
  content: z.string(),
  /** 文档子类型：overview / fact / migration */
  sub_type: z.nativeEnum(DocumentSubType),
  embedding: z.array(z.number()).optional()
})

export type DocumentMemory = z.infer<typeof DocumentMemorySchema>

/** 单次 LLM 调用返回的四类记忆原始结构，供 UnifiedExtractor 使用 */
export interface UnifiedExtractionResult {
  narrative?: { content?: string; summary?: string; keywords?: string[] } | null
  event_log?: { time?: string; atomic_fact?: string[] } | null
  foresight?: Array<{
    content?: string
    evidence?: string
    start_time?: string
    end_time?: string
    duration_days?: number
  }> | null
  profile?: { user_profiles?: Array<Record<string, unknown>> } | null
}

/** 文档迁移记忆抽取结果 */
export interface MigrationExtractionResult {
  changes: string[]
}

// ── Retrieval Types ──

/** 用于 agentic 检索：将用户 query 扩展为多条子查询（仅在有需要时使用） */
export interface IQueryExpansionProvider {
  expandQuery(query: string): Promise<string[]>
}

export interface SearchResult {
  id: string
  score: number
  content: string
  metadata: Record<string, any>
  type: MemoryType
  /** 来自 SQL 列，可选 */
  group_id?: string | null
  /** 来自 SQL 列，可选 */
  created_at?: string
  /** 来自 SQL 列，可选 */
  updated_at?: string
  /** 记忆来源类型 */
  source_type?: MemorySourceType | null
  /** 文档子类型 */
  sub_type?: DocumentSubType | null
}

export interface RetrieveRequest {
  query: string
  /** 用户 ID，默认 DEFAULT_USER_ID */
  user_id?: string
  group_id?: string
  limit?: number
  threshold?: number
  memory_types?: MemoryType[]
  method?: RetrieveMethod
  /** 是否在检索后做 rerank 精排；仅在需要高相关度时显式开启（会多一次 LLM 调用） */
  use_rerank?: boolean
}
