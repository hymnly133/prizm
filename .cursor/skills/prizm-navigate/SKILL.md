---
name: prizm-navigate
description: Quick lookup for the Prizm monorepo—where features live (agent chat, documents, workflow, tools, routes, adapters). Use when navigating the codebase, locating implementations, or answering "where is X" / "how does X work" in this project.
---

# Prizm 项目定位与查询

在 Prizm 仓库中快速定位功能、模块和入口。完整架构与命令见项目根目录 [CLAUDE.md](../../CLAUDE.md)。

## 包与入口

| 包 | 路径 | 入口/用途 |
|----|------|------------|
| Server | `prizm/` | `prizm/src/server.ts` 组装 Express、路由、WS |
| Electron 客户端 | `prizm-electron-client/` | `src/App.tsx`，React 19 + Ant Design |
| Client SDK | `prizm-client-core/` | HTTP/WS 客户端、Agent 工具封装 |
| 共享类型 | `prizm-shared/` | `domain.ts`、`events.ts`、`constants.ts` |
| 记忆系统 | `packages/evermemos/` | 长期记忆 TS 实现 |
| 管理面板 | `prizm/panel/` | Vue 3 仪表盘，`/dashboard/` |

## 按功能快速定位

### 服务端 (prizm/src/)

| 要找的内容 | 主要位置 |
|------------|----------|
| **Agent 会话/聊天** | `routes/agent/`（sessions.ts, chat.ts）、`adapters/DefaultAgentAdapter/` |
| **流式聊天核心** | `routes/agent/chatCore/`、`adapters/DefaultAgentAdapter/chatHelpers.ts` |
| **内置工具定义与执行** | `llm/builtinTools/`（definitions.ts, executor.ts, documentTools.ts 等） |
| **LLM 调用与工具流** | `adapters/DefaultAgentAdapter/`、`llm/OpenAILikeProvider.ts` 等 Provider |
| **文档 CRUD** | `routes/documents.ts`、`core/mdStore/documentStore.ts`、`llm/builtinTools/documentTools.ts` |
| **Todo** | `routes/todoList.ts`、`core/mdStore/todoStore.ts`、`llm/builtinTools/todoTools.ts` |
| **剪贴板** | `routes/clipboard.ts`、`core/mdStore/clipboardStore.ts` |
| **工作流** | `routes/workflow.ts`、`core/workflowEngine/`、`llm/builtinTools/workflowTools.ts`、`llm/toolLLM/` |
| **资源锁** | `core/resourceLockManager/`、`llm/builtinTools/lockTools.ts` |
| **领域事件** | `core/eventBus/`（eventBus.ts, types.ts, handlers/） |
| **WebSocket** | `websocket/`、`core/eventBus/handlers/wsBridgeHandlers.ts` |
| **认证** | `auth/`（ClientRegistry, authMiddleware） |
| **Scope 与存储** | `core/ScopeStore.ts`、`core/mdStore/`、`core/PathProviderCore.ts` |
| **记忆/Embedding** | `llm/EverMemService.ts`、`llm/localEmbedding.ts`、`routes/memory.ts`、`routes/embedding.ts` |
| **MCP** | `mcp/`（tools/, stdio-tools/）、`mcp-client/` |
| **适配器接口** | `adapters/interfaces.ts`；默认实现 `adapters/Default*.ts` |

### 客户端 (prizm-electron-client/src/)

| 要找的内容 | 主要位置 |
|------------|----------|
| **应用壳与路由** | `App.tsx`、`context/NavigationContext.tsx` |
| **Agent 会话 UI** | `components/agent/`（SessionChatPanel, ToolCallCard, InteractActionPanel 等） |
| **文档/编辑** | `components/editor/`、`components/DocumentPreviewModal.tsx`、`views/` |
| **工作流页** | `views/WorkflowPage.tsx`、`components/workflow/`、`store/workflowStore.ts` |
| **协作** | `views/CollaborationPage.tsx`、`components/collaboration/` |
| **状态** | `store/`（agentSessionStore, scopeDataStore, workflowStore 等） |
| **Chat 输入与 @ 引用** | `features/ChatInput/`、`utils/atRefPreprocess.ts`、`utils/refChipMeta.ts` |

### 共享与类型

- **跨端类型/常量**：`prizm-shared/src/`（domain.ts, events.ts, constants.ts）
- **客户端 API 类型**：`prizm-client-core/src/types.ts`；HTTP 封装在 `http/`（mixins: agent, files, workflow, toolLLM, settings 等）

## 查询策略

- **“X 在哪 / 如何实现”**：用 **SemanticSearch**，在对应包下搜（例如 `prizm/src/` 或 `prizm-electron-client/src/`），问完整句子如 “Where is agent stream chat handled?”。
- **已知类名/函数名/路由路径**：用 **Grep** 精确匹配（如 `createPrizmServer`、`/agent/sessions`、`DefaultAgentAdapter`）。
- **路由与 API**：先看 `prizm/src/server.ts` 挂载了哪些路由；具体实现到 `routes/*.ts` 或 `routes/agent/*.ts`。
- **数据流**：服务端从 `adapters` 和 `core/mdStore` 入手；客户端从 `store/` 和对应 view/component 入手。

## 测试与命令

- 服务端单测：`prizm/` 下 `yarn test`，测试文件为 `*.test.ts` 与源文件同目录。
- 客户端：`prizm-electron-client/` 下 `yarn dev`、`yarn typecheck`。
- 完整命令、环境变量、端口：见 [CLAUDE.md](../../CLAUDE.md)。
