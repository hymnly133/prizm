/**
 * PrizmClient 相关类型定义
 */

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'streamable-http' | 'sse'
  stdio?: { command: string; args?: string[]; env?: Record<string, string> }
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

export interface McpTool {
  serverId: string
  name: string
  fullName: string
  description?: string
  inputSchema?: object
}

/** 内置工具：Tavily 联网搜索 */
export interface TavilySettings {
  apiKey?: string
  enabled?: boolean
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  configured?: boolean
}

/** 内置 Skill 源：SkillsMP 市场（需 API Key） */
export interface SkillsMPSettings {
  apiKey?: string
  configured?: boolean
}

/** 文档记忆设置（原 DocumentSummarySettings） */
export interface DocumentSummarySettings {
  enabled?: boolean
  minLen?: number
}

/** 对话摘要设置 */
export interface ConversationSummarySettings {
  enabled?: boolean
  interval?: number
  model?: string
}

/** 上下文窗口 A/B 压缩配置 */
export interface ContextWindowSettings {
  fullContextTurns?: number
  cachedContextTurns?: number
}

/** Agent LLM 设置 */
export interface AgentLLMSettings {
  documentSummary?: DocumentSummarySettings
  conversationSummary?: ConversationSummarySettings
  defaultModel?: string
  memory?: MemorySettings
  contextWindow?: ContextWindowSettings
}

/** 记忆模块设置 */
export interface MemorySettings {
  enabled?: boolean
  model?: string
}

/** 终端会话信息（客户端视图） */
export interface TerminalSessionInfo {
  id: string
  agentSessionId: string
  scope: string
  sessionType: 'exec' | 'interactive'
  shell: string
  cwd: string
  cols: number
  rows: number
  pid: number
  title?: string
  status: 'running' | 'exited'
  exitCode?: number
  signal?: number
  createdAt: number
  lastActivityAt: number
}

/** 终端设置 */
export interface TerminalSettings {
  defaultShell?: string
}

/** Agent 工具统一设置 */
export interface AgentToolsSettings {
  builtin?: { tavily?: TavilySettings; skillsmp?: SkillsMPSettings }
  agent?: AgentLLMSettings
  mcpServers?: McpServerConfig[]
  terminal?: TerminalSettings
  updatedAt?: number
}

/** 可用 Shell 信息 */
export interface ShellInfo {
  path: string
  label: string
  isDefault: boolean
}

/** 工作区类型 */
export type ExecWorkspaceType = 'main' | 'session'

/** Exec Worker 状态信息 */
export interface ExecWorkerInfo {
  agentSessionId: string
  workspaceType: ExecWorkspaceType
  shell: string
  cwd: string
  pid: number
  busy: boolean
  exited: boolean
  createdAt: number
  lastActivityAt: number
  commandCount: number
}

/** Exec 命令执行记录 */
export interface ExecRecordInfo {
  id: string
  agentSessionId: string
  workspaceType: ExecWorkspaceType
  command: string
  output: string
  exitCode: number
  timedOut: boolean
  startedAt: number
  finishedAt: number
}

/** 可用模型项 */
export interface AvailableModel {
  id: string
  label: string
  provider: string
}

// ==================== Embedding 类型 ====================

/** Embedding 推理统计 */
export interface EmbeddingStats {
  totalCalls: number
  totalErrors: number
  totalCharsProcessed: number
  avgLatencyMs: number
  p95LatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  lastError: { message: string; timestamp: number } | null
  modelLoadTimeMs: number
}

/** Embedding 模型完整状态 */
export interface EmbeddingStatus {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'disposing'
  modelName: string
  dimension: number
  enabled: boolean
  dtype: string
  /** 模型加载来源：'bundled' | 'cache' | 'download' */
  source: string
  stats: EmbeddingStats
  cacheDir: string
  /** 模型专属内存估算（加载前后堆差值），单位 MB */
  modelMemoryMb: number
  /** Node.js 进程 RSS，单位 MB */
  processMemoryMb: number
  upSinceMs: number | null
}

/** 向量统计信息 */
export interface VectorStats {
  mean: number
  std: number
  min: number
  max: number
  norm: number
}

/** 相似度等级 */
export type SimilarityLevel = 'very_high' | 'high' | 'medium' | 'low' | 'very_low'

/** Embedding 测试结果 */
export interface EmbeddingTestResult {
  text: string
  textLength: number
  dimension: number
  latencyMs: number
  vectorPreview: number[]
  vectorStats: VectorStats
  vectorFull?: number[]
  /** 以下字段仅在提供 compareWith 时返回 */
  compareWith?: string
  compareTextLength?: number
  compareLatencyMs?: number
  compareVectorPreview?: number[]
  compareVectorStats?: VectorStats
  /** 原始余弦相似度 */
  similarity?: number
  /** 校准后的相似度（消除模型基线偏移） */
  calibratedSimilarity?: number
  similarityLevel?: SimilarityLevel
  similarityLabel?: string
}

/** 基准测试期望类型 */
export type BenchmarkExpected = 'high' | 'low' | 'cross_lang' | 'antonym'

/** 基准测试单对结果 */
export interface BenchmarkPairResult {
  textA: string
  textB: string
  category: string
  expected: BenchmarkExpected
  /** 原始余弦相似度 */
  similarity: number
  /** 校准后的相似度 */
  calibratedSimilarity: number
  similarityLevel: SimilarityLevel
  similarityLabel: string
  /** true=通过, false=未通过, null=反义词对（已知限制，不参与评分） */
  pass: boolean | null
}

/** 基准测试汇总统计 */
export interface BenchmarkSummary {
  totalPairs: number
  /** 参与评分的对数（排除 cross_lang + antonym） */
  scorablePairs: number
  /** 跨语言对数（小模型已知限制，不参与评分） */
  crossLangPairs: number
  /** 反义词对数（不参与评分） */
  antonymPairs: number
  passCount: number
  failCount: number
  passRate: number
  /** 统一判定阈值（calibrated） */
  threshold: number
  avgHighCalibratedSimilarity: number
  avgLowCalibratedSimilarity: number
  /** 跨语言对校准均值（仅供参考） */
  avgCrossLangCalibratedSimilarity: number
  /** 区分度 = 高相似对校准均值 - 低相似对校准均值 */
  discrimination: number
  totalLatencyMs: number
  modelName: string
  dimension: number
}

/** 基准测试完整结果 */
export interface EmbeddingBenchmarkResult {
  pairs: BenchmarkPairResult[]
  summary: BenchmarkSummary
}

/** Embedding 重载结果 */
export interface EmbeddingReloadResult {
  message: string
  previousState: string
  currentState: string
  modelName: string
  dimension: number
  dtype: string
  loadTimeMs: number
}

// ============ Agent Rules ============

export type RuleLevel = 'user' | 'scope'

/** Agent 自定义规则 */
export interface AgentRule {
  id: string
  title: string
  content: string
  enabled: boolean
  level: RuleLevel
  scope?: string
  alwaysApply: boolean
  globs?: string[]
  description?: string
  createdAt: number
  updatedAt: number
}

/** 创建规则的输入 */
export interface CreateAgentRuleInput {
  id: string
  title: string
  content: string
  level: RuleLevel
  scope?: string
  enabled?: boolean
  alwaysApply?: boolean
  globs?: string[]
  description?: string
}

/** 更新规则的输入 */
export interface UpdateAgentRuleInput {
  title?: string
  content?: string
  enabled?: boolean
  alwaysApply?: boolean
  globs?: string[]
  description?: string
}
