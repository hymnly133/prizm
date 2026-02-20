/**
 * Agent 内置工具：文件系统、待办/文档 CRUD、搜索、统计、终端
 * 工具定义与执行拆分为 builtinTools/ 子模块，本文件为统一 re-export，保持原有导入路径不变。
 */

export { getBuiltinTools, BUILTIN_TOOL_NAMES } from './builtinTools/definitions'
export type { ToolPropertyDef } from './builtinTools/definitions'
export { executeBuiltinTool } from './builtinTools/executor'
export type { BuiltinToolResult } from './builtinTools/types'
export { setSearchIndexForTools, getSearchIndexForTools } from './builtinTools/searchTools'
export {
  filterToolsByGroups,
  resolveGroupStates,
  getAllToolGroups,
  getToolGroupId,
  getToolGroup,
  BUILTIN_TOOL_GROUPS
} from './builtinTools/toolGroups'
export type { ToolGroup, ToolGroupConfig } from './builtinTools/toolGroups'
