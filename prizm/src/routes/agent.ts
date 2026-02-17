/**
 * Agent 路由 - 会话 CRUD、流式对话、停止生成
 * 入口文件：组装各子模块路由
 */

import type { Router } from 'express'
import type { IAgentAdapter } from '../adapters/interfaces'
import { registerMetadataRoutes } from './agent/metadata'
import { registerSessionRoutes } from './agent/sessions'
import { registerChatRoutes } from './agent/chat'

export function createAgentRoutes(router: Router, adapter?: IAgentAdapter): void {
  registerMetadataRoutes(router)
  registerSessionRoutes(router, adapter)
  registerChatRoutes(router, adapter)
}
