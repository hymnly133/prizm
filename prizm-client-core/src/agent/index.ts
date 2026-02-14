/**
 * Agent 元数据与注册表 - 供客户端 ToolCallCard 等使用
 * 工具卡片 UI 组件在 electron-client 中实现（使用 Lobe UI）
 */

export {
  getToolDisplayName,
  getToolMetadata,
  setToolMetadata,
  isPrizmTool,
  isTavilyTool,
  type ToolMetadata
} from './ToolMetadataRegistry'
export {
  registerToolRender,
  getToolRender,
  unregisterToolRender,
  type ToolRenderFn
} from './ToolRenderRegistry'
