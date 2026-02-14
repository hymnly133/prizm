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

export const ProjectInfoSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  entry_date: z.string(),
  subtasks: z.array(z.record(z.any())).optional(),
  user_objective: z.array(z.record(z.any())).optional(),
  contributions: z.array(z.record(z.any())).optional(),
  user_concerns: z.array(z.record(z.any())).optional()
})

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>

export const ImportanceEvidenceSchema = z.object({
  user_id: z.string(),
  group_id: z.string(),
  speak_count: z.number().default(0),
  refer_count: z.number().default(0),
  conversation_count: z.number().default(0)
})

export type ImportanceEvidence = z.infer<typeof ImportanceEvidenceSchema>

export const GroupImportanceEvidenceSchema = z.object({
  group_id: z.string(),
  evidence_list: z.array(ImportanceEvidenceSchema),
  is_important: z.boolean()
})

export type GroupImportanceEvidence = z.infer<typeof GroupImportanceEvidenceSchema>

export const ProfileMemorySchema = BaseMemorySchema.extend({
  user_name: z.string().optional(),
  hard_skills: z.array(z.record(z.any())).optional(),
  soft_skills: z.array(z.record(z.any())).optional(),
  output_reasoning: z.string().optional(),
  way_of_decision_making: z.array(z.record(z.any())).optional(),
  personality: z.array(z.record(z.any())).optional(),
  projects_participated: z.array(ProjectInfoSchema).optional(),
  user_goal: z.array(z.record(z.any())).optional(),
  work_responsibility: z.array(z.record(z.any())).optional(),
  working_habit_preference: z.array(z.record(z.any())).optional(),
  interests: z.array(z.record(z.any())).optional(),
  tendency: z.array(z.record(z.any())).optional(),
  motivation_system: z.array(z.record(z.any())).optional(),
  fear_system: z.array(z.record(z.any())).optional(),
  value_system: z.array(z.record(z.any())).optional(),
  humor_use: z.array(z.record(z.any())).optional(),
  colloquialism: z.array(z.record(z.any())).optional(),
  group_importance_evidence: GroupImportanceEvidenceSchema.optional()
})

export type ProfileMemory = z.infer<typeof ProfileMemorySchema>

export const EventLogSchema = BaseMemorySchema.extend({
  content: z.string(),
  event_type: z.string().optional(),
  embedding: z.array(z.number()).optional()
})

export type EventLog = z.infer<typeof EventLogSchema>

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
