/**
 * 统一路径提供器 - 集中管理所有存储路径
 * 应用级：.prizm-data/
 * Scope 级：{scopeRoot}/.prizm/ 或 {scopeRoot}/
 */

import path from 'path'
import { scopeStore } from './ScopeStore'
import {
  getDataDir as _getDataDir,
  getScopesDir,
  getScopeRegistryPath,
  getPrizmDir,
  getScopeJsonPath,
  getTypesJsonPath,
  getCacheJsonPath,
  getSearchIndexPath,
  getTokenUsagePath,
  getAgentSessionsDir,
  getClipboardDir,
  getClientsPath,
  getAgentToolsPath,
  getMcpServersPath,
  getUsersDir,
  getUserDir,
  getMemoryDbPath,
  getMemoryVectorPath,
  ensureDataDir,
  ensureMemoryDir
} from './PathProviderCore'

export {
  getDataDir,
  getSearchIndexDbPath,
  getUserMemoryDbPath,
  getUserMemoryVecPath,
  getScopeMemoryDir,
  getScopeMemoryDbPath,
  getScopeMemoryVecPath,
  getSessionDir,
  getSessionFilePath,
  getSessionSummaryPath,
  getSessionTokenUsagePath,
  getSessionActivitiesPath,
  getSessionMemoriesPath,
  ensureScopeMemoryDir
} from './PathProviderCore'
export {
  getScopesDir,
  getPrizmDir,
  getScopeJsonPath,
  getTypesJsonPath,
  getCacheJsonPath,
  getSearchIndexPath,
  getTokenUsagePath,
  getAgentSessionsDir,
  getClipboardDir,
  getScopeRegistryPath,
  getClientsPath,
  getAgentToolsPath,
  getMcpServersPath,
  getUsersDir,
  getUserDir,
  getMemoryDbPath,
  getMemoryVectorPath,
  ensureDataDir,
  ensureMemoryDir
} from './PathProviderCore'

/** Scope 根目录（内置 scope 或注册的自定义路径） */
export function getScopeRootPath(scopeId: string): string {
  const root = scopeStore.getScopeRootPath(scopeId)
  if (root) return root
  return path.join(_getDataDir(), 'scopes', scopeId)
}
