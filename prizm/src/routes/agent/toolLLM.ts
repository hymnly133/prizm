/**
 * 工作流管理会话已改为走通用 Agent 聊天流，不再提供独立 tool-llm 路由。
 * 创建/更新工具由 Adapter 按会话绑定状态注入，执行器在工具调用时完成注册与绑定。
 */

import type { Router } from 'express'

export function registerToolLLMRoutes(_router: Router): void {
  // No routes: workflow management chat uses generic agent stream (POST /agent/chat etc.)
}
