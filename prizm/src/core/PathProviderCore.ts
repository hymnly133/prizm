/**
 * 路径提供器核心 - 不含 scopeStore 依赖，避免循环引用
 * 应用级：.prizm-data/
 * Scope 级：{scopeRoot}/.prizm/ 或 {scopeRoot}/
 */

import fs from 'fs'
import path from 'path'
import { getConfig } from '../config'

const SCOPES_DIR = 'scopes'
const PRIZM_DIR = '.prizm'
const USERS_DIR = 'users'
const MEMORY_DIR = 'memory'

const SCOPE_REGISTRY_FILE = 'scope-registry.json'
const CLIENTS_FILE = 'clients.json'
const AGENT_TOOLS_FILE = 'agent-tools.json'
const MCP_SERVERS_FILE = 'mcp-servers.json'

const SCOPE_JSON = 'scope.json'
const TYPES_JSON = 'types.json'
const CACHE_JSON = 'cache.json'
const SEARCH_INDEX_FILE = 'search-index.json'
const TOKEN_USAGE_FILE = 'token_usage.md'

const AGENT_SESSIONS_DIR = 'agent-sessions'
const CLIPBOARD_DIR = 'clipboard'
const SESSION_WORKSPACE_DIR = 'workspace'

const EVERMEMOS_DB = 'evermemos.db'
const EVERMEMOS_VEC = 'evermemos_vec'
const USER_DB = 'user.db'
const USER_VEC = 'user_vec'
const SCOPE_DB = 'scope.db'
const SCOPE_VEC = 'scope_vec'
const SESSION_MD = 'session.md'
const SUMMARY_MD = 'summary.md'
const ACTIVITIES_JSON = 'activities.json'
const MEMORIES_MD = 'memories.md'
const SEARCH_INDEX_DB = 'search-index.db'

export function getDataDir(): string {
  return path.resolve(getConfig().dataDir)
}

export function getScopesDir(): string {
  return path.join(getDataDir(), SCOPES_DIR)
}

export function getPrizmDir(scopeRoot: string): string {
  return path.join(scopeRoot, PRIZM_DIR)
}

export function getScopeJsonPath(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), SCOPE_JSON)
}

export function getTypesJsonPath(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), TYPES_JSON)
}

export function getCacheJsonPath(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), CACHE_JSON)
}

export function getSearchIndexPath(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), SEARCH_INDEX_FILE)
}

export function getTokenUsagePath(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), TOKEN_USAGE_FILE)
}

export function getAgentSessionsDir(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), AGENT_SESSIONS_DIR)
}

export function getClipboardDir(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), CLIPBOARD_DIR)
}

/** @deprecated 番茄钟已移除，仅用于迁移清理 */
export function getPomodoroDir(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), 'pomodoro')
}

export function getScopeRegistryPath(): string {
  return path.join(getDataDir(), SCOPE_REGISTRY_FILE)
}

export function getClientsPath(): string {
  return path.join(getDataDir(), CLIENTS_FILE)
}

export function getAgentToolsPath(): string {
  return path.join(getDataDir(), AGENT_TOOLS_FILE)
}

export function getMcpServersPath(): string {
  return path.join(getDataDir(), MCP_SERVERS_FILE)
}

export function getUsersDir(): string {
  return path.join(getDataDir(), USERS_DIR)
}

export function getUserDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous'
  return path.join(getUsersDir(), safe)
}

export function getMemoryDbPath(): string {
  return path.join(getDataDir(), MEMORY_DIR, EVERMEMOS_DB)
}

export function getMemoryVectorPath(): string {
  return path.join(getDataDir(), MEMORY_DIR, EVERMEMOS_VEC)
}

// ============ 用户/scope 级记忆 DB（两级拆分） ============

/** .prizm-data/memory/user.db（用户级 PROFILE 记忆） */
export function getUserMemoryDbPath(): string {
  return path.join(getDataDir(), MEMORY_DIR, USER_DB)
}

/** .prizm-data/memory/user_vec（用户级向量库） */
export function getUserMemoryVecPath(): string {
  return path.join(getDataDir(), MEMORY_DIR, USER_VEC)
}

/** {scopeRoot}/.prizm/memory/（scope 级记忆目录） */
export function getScopeMemoryDir(scopeRoot: string): string {
  return path.join(getPrizmDir(scopeRoot), MEMORY_DIR)
}

/** {scopeRoot}/.prizm/memory/scope.db（scope 级记忆 DB） */
export function getScopeMemoryDbPath(scopeRoot: string): string {
  return path.join(getScopeMemoryDir(scopeRoot), SCOPE_DB)
}

/** {scopeRoot}/.prizm/memory/scope_vec（scope 级向量库） */
export function getScopeMemoryVecPath(scopeRoot: string): string {
  return path.join(getScopeMemoryDir(scopeRoot), SCOPE_VEC)
}

// ============ session 级路径 ============

/** {scopeRoot}/.prizm/agent-sessions/{sessionId}/ */
export function getSessionDir(scopeRoot: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
  return path.join(getAgentSessionsDir(scopeRoot), safe)
}

/** {sessionDir}/session.md */
export function getSessionFilePath(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), SESSION_MD)
}

/** {sessionDir}/summary.md */
export function getSessionSummaryPath(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), SUMMARY_MD)
}

/** {sessionDir}/token_usage.md */
export function getSessionTokenUsagePath(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), TOKEN_USAGE_FILE)
}

/** {sessionDir}/activities.json */
export function getSessionActivitiesPath(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), ACTIVITIES_JSON)
}

/** {sessionDir}/memories.md */
export function getSessionMemoriesPath(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), MEMORIES_MD)
}

/** {sessionDir}/workspace/ - 会话临时工作区 */
export function getSessionWorkspaceDir(scopeRoot: string, sessionId: string): string {
  return path.join(getSessionDir(scopeRoot, sessionId), SESSION_WORKSPACE_DIR)
}

/** .prizm-data/search-index.db（搜索索引 SQLite，与 memory 分离） */
export function getSearchIndexDbPath(baseDir?: string): string {
  const root = baseDir ? path.resolve(baseDir) : getDataDir()
  return path.join(root, SEARCH_INDEX_DB)
}

export function ensureDataDir(): void {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function ensureMemoryDir(): void {
  ensureDataDir()
  const dir = path.join(getDataDir(), MEMORY_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 确保 scope 级 memory 目录存在 */
export function ensureScopeMemoryDir(scopeRoot: string): void {
  const dir = getScopeMemoryDir(scopeRoot)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
