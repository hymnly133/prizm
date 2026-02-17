import { z } from 'zod'

// Enum Definitions
export enum RawDataType {
  CONVERSATION = 'conversation',
  IMAGE = 'image',
  TEXT = 'text',
  LINK = 'link',
  NOTE = 'note',
  FILE = 'file',
  UNKNOWN = 'unknown'
}

export enum MemoryType {
  EPISODIC_MEMORY = 'episodic_memory',
  FORESIGHT = 'foresight',
  EVENT_LOG = 'event_log',
  PROFILE = 'profile',
  GROUP_PROFILE = 'group_profile'
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

// Zod Schemas & Types

export const BaseMemorySchema = z.object({
  id: z.string().optional(),
  created_at: z.string().optional(), // ISO string
  updated_at: z.string().optional(),
  timestamp: z.string().optional(),
  user_id: z.string().optional(),
  group_id: z.string().optional(),
  deleted: z.boolean().default(false),
  memory_type: z.nativeEnum(MemoryType).optional(),
  embedding: z.array(z.number()).optional(),
  content: z.string().optional(),
  metadata: z.any().optional()
})

export type BaseMemory = z.infer<typeof BaseMemorySchema>

/** 场景：assistant=1:1 对话；group=群聊；document=文档（仅 Episode+EventLog） */
export type MemCellScene = 'assistant' | 'group' | 'document'

/**
 * 三层记忆路由上下文，告知 MemoryManager 如何按 memory_type 设定 group_id：
 * - Profile → user_id only, group_id=null（User 层）
 * - Episodic/Foresight → group_id=scope（Scope 层）
 * - EventLog → group_id=scope:session:sessionId（Session 层）
 * - Document → group_id=scope:docs（Scope:Document 层）
 */
export interface MemoryRoutingContext {
  /** 真实用户 ID（如 clientId） */
  userId: string
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
}

export const MemCellSchema = BaseMemorySchema.extend({
  event_id: z.string().optional(),
  type: z.nativeEnum(RawDataType),
  original_data: z.any(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  text: z.string().optional(),
  /** group=跳过 Foresight/EventLog；document=仅 Episode+EventLog */
  scene: z.enum(['assistant', 'group', 'document']).optional()
})

export type MemCell = z.infer<typeof MemCellSchema>

export const EpisodeMemorySchema = BaseMemorySchema.extend({
  content: z.string(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  embedding: z.array(z.number()).optional()
})

export type EpisodeMemory = z.infer<typeof EpisodeMemorySchema>

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
 *
 * 注：Python 原版 EverMemOS 的 ProfileMemory 包含 hard_skills/personality 等 15 个结构化字段，
 * 依赖专用的 3 段 LLM prompt（Part1/2/3）填充。TS Unified 路径仅使用原子化 items，已移除。
 * 如需恢复结构化抽取，可添加专用 ProfileStructuredExtractor 并在 metadata 中扩展字段。
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

/** 单次 LLM 调用返回的四类记忆原始结构，供 UnifiedExtractor 使用 */
export interface UnifiedExtractionResult {
  episode?: { content?: string; summary?: string; keywords?: string[] } | null
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

// Retrieval Types

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
}

export interface RetrieveRequest {
  query: string
  user_id?: string
  group_id?: string
  limit?: number
  threshold?: number
  memory_types?: MemoryType[]
  method?: RetrieveMethod
  /** 是否在检索后做 rerank 精排；仅在需要高相关度时显式开启（会多一次 LLM 调用） */
  use_rerank?: boolean
}
