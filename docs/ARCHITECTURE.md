# Prizm 项目架构文档

本文档按**功能模块**整理 Prizm  monorepo 的架构，与代码库实际结构保持同步。面向开发者快速定位模块与数据流。

---

## 1. 总览与仓库结构

### 1.1 Monorepo 包一览

| 包 | 路径 | 说明 |
|----|------|------|
| **@prizm/server** | `prizm/` | HTTP API 服务端，内置 Vue 面板与 MCP 服务，默认端口 4127 |
| **@prizm/electron-client** | `prizm-electron-client/` | Electron 40 桌面客户端，React 19 + Ant Design |
| **@prizm/client-core** | `prizm-client-core/` | 共享客户端 SDK：HTTP/WebSocket、Agent 工具元数据与渲染 |
| **@prizm/shared** | `prizm-shared/` | 跨包类型与常量：领域模型、事件、认证、WebSocket 消息 |
| **@prizm/evermemos** | `packages/evermemos/` | TypeScript 记忆系统：LanceDB + SQLite，抽取与检索 |
| **@prizm/prizm-stagehand** | `packages/prizm-stagehand/` | Stagehand 集成层：通过 CDP relay 连接浏览器，供 Agent 浏览器工具使用 |
| **Panel** | `prizm/panel/` | Vue 3 内置管理面板，挂载于 `/dashboard/` |
| **Website** | `website/` | 对外官网/落地页（独立 Vite 应用） |
| **EverMemOS** | `EverMemOS/` | Python FastAPI 长期记忆系统（独立，非 TS workspace） |

### 1.2 产品定位：Panel vs Electron 客户端

| 入口 | 定位 | 用途 |
|------|------|------|
| **内置面板**（Vue，`/dashboard/`） | 系统控制台 | 全量数据与配置：概览、便签、任务、文档、剪贴板、Agent 会话、Token、权限、Agent 工具、LLM、MCP |
| **Electron 客户端** | 用户日常入口 | 工作台、文档编辑、Agent 协作、工作流、记忆与用量、完整交互与实时同步 |

开发/运维用控制台；日常使用以 Electron 客户端为主。

### 1.3 服务端技术栈

- Node.js + TypeScript（ESM，tsup 构建）
- Express 5.x
- 双路 WebSocket：`/ws` 事件推送、`/ws/terminal` 终端 I/O
- 领域事件总线（Emittery）解耦模块通信

---

## 2. 认证与授权

| 模块 | 路径 | 职责 |
|------|------|------|
| 客户端注册与持久化 | `prizm/src/auth/ClientRegistry.ts` | API Key 管理，存于 `.prizm-data/clients.json` |
| 认证与 Scope 校验 | `prizm/src/auth/authMiddleware.ts` | JWT 风格校验；请求 Scope 须在客户端 `allowedScopes` 内 |

**认证方式**：`Authorization: Bearer <key>`、`X-Prizm-Api-Key`、`?apiKey=`。  
**豁免**：请求头 `X-Prizm-Panel: true`（面板）；环境变量 `PRIZM_AUTH_DISABLED=1`（开发）。

---

## 3. 数据与存储

### 3.1 Scope 与运行时存储

| 模块 | 路径 | 职责 |
|------|------|------|
| Scope 数据隔离 | `prizm/src/core/ScopeStore.ts` | 按 scope 的内存缓存，与 mdStore 协同 |
| Scope 注册与路径 | `prizm/src/core/ScopeRegistry.ts`、`PathProvider.ts`、`PathProviderCore.ts` | 应用级与 scope 级路径 |
| 元数据缓存 | `prizm/src/core/MetadataCache.ts` | 文档/列表等元数据缓存 |
| 用户与配置 | `prizm/src/core/UserStore.ts`、`prizm/src/settings/userProfileStore.ts` | 用户信息与配置 |

Scope 通过请求头 `X-Prizm-Scope` 或查询参数 `?scope=` 指定；默认 `default`。

### 3.2 Markdown 存储层（mdStore V3）

| 模块 | 路径 | 职责 |
|------|------|------|
| 文件操作 | `prizm/src/core/mdStore/fileOps.ts` | 读写、列表、移动 |
| 文档 / 待办 / 剪贴板 / 会话 / Token 使用 | `documentStore.ts`、`todoStore.ts`、`clipboardStore.ts`、`sessionStore.ts`、`tokenUsageStore.ts` | 各实体 CRUD，YAML frontmatter + Markdown body |
| 工具 | `prizm/src/core/mdStore/utils.ts` | 如 `sanitizeFileName` |

持久化路径：`.prizm-data/scopes/{scope}/` 下按类型分单文件 `.md`，变更即写盘。

### 3.3 资源锁（Fencing Token）

| 模块 | 路径 | 职责 |
|------|------|------|
| 锁管理 | `prizm/src/core/resourceLockManager/lockManager.ts` | 获取/释放/校验锁 |
| 存储 | `prizm/src/core/resourceLockManager/lockStore.ts` | SQLite：`.prizm-data/resource_locks.db` |

支持资源类型：`document`、`todo_list`。特性：Fencing 递增 token、TTL（默认 5 分钟）、心跳续期、会话结束时自动释放（通过事件总线）。

### 3.4 审计与反馈

| 模块 | 路径 | 职责 |
|------|------|------|
| 审计 | `prizm/src/core/agentAuditLog/` | 记录 Agent 工具执行，SQLite `.prizm-data/agent_audit.db`，90 天保留 |
| 反馈 | `prizm/src/core/feedback/` | 用户反馈 CRUD、统计，SQLite `.prizm-data/feedback.db` |

### 3.5 其他持久化

- **Token 用量**：`prizm/src/core/tokenUsageDb.ts` → `.prizm-data/token_usage.db`
- **文档版本**：`prizm/src/core/documentVersionStore.ts`
- **搜索索引**：`prizm/src/search/searchIndexService.ts` → `.prizm-data/search_index.db`

---

## 4. 领域事件与 WebSocket

### 4.1 事件总线（EventBus）

| 模块 | 路径 | 职责 |
|------|------|------|
| 总线核心 | `prizm/src/core/eventBus/eventBus.ts` | `emit` / `subscribe` / `subscribeOnce` / `subscribeAny` |
| 事件类型 | `prizm/src/core/eventBus/types.ts` | `DomainEventMap` 全量事件定义 |

**主要领域事件**（节选）：

| 事件 | 触发场景 | 用途 |
|------|----------|------|
| `agent:session.created` / `agent:session.deleted` | 会话创建/删除 | 生命周期、锁释放、记忆缓冲清理 |
| `agent:message.completed` / `agent:session.compressing` | 消息完成/压缩 | 记忆抽取 |
| `agent:session.rolledBack` | 回退到 checkpoint | 回滚相关清理与通知 |
| `tool:executed` | 工具执行 | 审计写入 |
| `document:saved` / `document:deleted` | 文档保存/删除 | 记忆抽取、WS 通知 |
| `resource:lock.changed` | 锁变更 | WS 通知 |
| `file:operation` | 文件创建/移动/删除 | WS 通知 |
| `feedback:submitted` | 用户反馈 | 审计、偏好记忆、WS 通知 |

### 4.2 事件处理器（handlers）

| 处理器 | 路径 | 绑定事件与行为 |
|--------|------|----------------|
| auditHandlers | `core/eventBus/handlers/auditHandlers.ts` | `tool:executed` → 审计落库 |
| lockHandlers | `core/eventBus/handlers/lockHandlers.ts` | `agent:session.deleted` → 释放该会话持有锁 |
| memoryHandlers | `core/eventBus/handlers/memoryHandlers.ts` | `document:saved` → 记忆抽取；`agent:session.deleted` → 清会话缓冲 |
| feedbackHandlers | `core/eventBus/handlers/feedbackHandlers.ts` | `feedback:submitted` → 审计 + 偏好记忆 |
| wsBridgeHandlers | `core/eventBus/handlers/wsBridgeHandlers.ts` | 领域事件 → WebSocket 广播 |
| bgSessionHandlers | `core/eventBus/handlers/bgSessionHandlers.ts` | 后台会话相关 |
| scheduleHandlers | `core/eventBus/handlers/scheduleHandlers.ts` | 日程/提醒相关 |
| searchHandlers | `core/eventBus/handlers/searchHandlers.ts` | 搜索索引相关 |

### 4.3 WebSocket 服务

| 模块 | 路径 | 职责 |
|------|------|------|
| 事件 WS | `prizm/src/websocket/WebSocketServer.ts` | `/ws`，按事件类型订阅，服务端可 `broadcast` / `broadcastToClient` |
| 终端 WS | `prizm/src/terminal/TerminalWebSocketServer.ts` | `/ws/terminal`，交互式终端 I/O |
| 浏览器中继 | `prizm/src/websocket/BrowserRelayServer.ts` | 浏览器控制（如 Stagehand）的 relay 服务 |

---

## 5. Agent 与 LLM

### 5.1 适配器

| 接口/实现 | 路径 | 职责 |
|-----------|------|------|
| 接口定义 | `prizm/src/adapters/interfaces.ts` | INotificationAdapter、ITodoListAdapter、IClipboardAdapter、IDocumentsAdapter、IAgentAdapter、ILLMProvider |
| 默认实现工厂 | `prizm/src/adapters/default.ts` | createDefaultAdapters |
| DefaultAgentAdapter | `prizm/src/adapters/DefaultAgentAdapter/` | 会话、消息、流式对话、工具执行（含 sessionToolFilter、toolExecution） |
| DefaultDocumentsAdapter / DefaultTodoListAdapter / DefaultClipboardAdapter / DefaultNotificationAdapter | `prizm/src/adapters/` | 文档/待办/剪贴板/通知的默认实现 |

### 5.2 LLM 与对话

| 模块 | 路径 | 职责 |
|------|------|------|
| LLM 适配 | `prizm/src/llm/prizmLLMAdapter.ts` | DefaultAgentAdapter 使用的 LLM 抽象 |
| AI SDK 桥接 | `prizm/src/llm/aiSdkBridge/` | 多厂商（OpenAI/Anthropic/Google）通过服务端配置解析与调用 |
| 模型列表 | `prizm/src/llm/modelLists.ts` | 模型定义 |
| 系统提示与上下文 | `prizm/src/llm/systemPrompt.ts`、`scopeContext.ts` | 系统提示构建、Scope 上下文（便签/待办/文档注入） |
| 提示流水线 | `prizm/src/llm/promptPipeline/` | 提示组装与流水线 |
| 上下文预算 | `prizm/src/llm/contextBudget/` | 上下文窗口与预算控制 |
| 对话摘要 | `prizm/src/llm/conversationSummaryService.ts` | 对话压缩与摘要 |
| 文档记忆 | `prizm/src/llm/documentMemoryService.ts` | 文档相关记忆 |
| 流式 tool calls | `prizm/src/llm/streamToolCallsReducer.ts`、`streamToolsCompatibility.ts` | 流式工具调用状态与兼容层 |
| 交互审批 | `prizm/src/llm/interactManager.ts` | 用户对工具调用的审批流程 |
| Stagehand 定制 LLM 客户端 | `prizm/src/llm/stagehandLLMClient.ts` | 浏览器自动化场景下为 Stagehand 提供模型配置 |

### 5.3 内置工具（builtinTools）

| 模块 | 路径 | 职责 |
|------|------|------|
| 定义与执行 | `prizm/src/llm/builtinTools/definitions.ts`、`executor.ts`、`types.ts` | OpenAI 风格 schema、执行引擎、分组（toolGroups.ts） |
| 文档 / 锁 / 待办 | `documentTools.ts`、`lockTools.ts`、`todoTools.ts` | 文档 CRUD（带锁）、锁 checkout/checkin、待办 CRUD |
| 文件 / 终端 | `fileTools.ts`、`terminalTools.ts` | 工作区文件操作、终端执行 |
| 搜索 / 知识库 | `searchTools.ts`、`knowledgeTools.ts` | 统一搜索、知识库查询 |
| 工作流 / 任务 / 日程 / Cron | `workflowTools.ts`、`taskTools.ts`、`scheduleTools.ts`、`cronTools.ts` | 工作流与后台任务、日程提醒、Cron |
| 技能 | `skillTools.ts` | 技能指令获取等 |
| 浏览器 | `prizm/src/llm/builtinTools/browserTools.ts` | 浏览器自动化（依赖 Stagehand/relay） |
| 统一入口 | `prizm/src/llm/builtinTools.ts` | 注册与导出 |

### 5.4 技能、规则与 Slash 命令

| 模块 | 路径 | 职责 |
|------|------|------|
| 技能管理 | `prizm/src/llm/skillManager.ts` | 加载、激活、注入技能指令；详见 `docs/skill-module-architecture.md` |
| Agent 规则 | `prizm/src/llm/agentRulesManager.ts` | 用户级（`.prizm-data/rules/`）与 Scope 级（`{scopeRoot}/.prizm/rules/`）规则，Markdown + YAML frontmatter |
| 外部规则加载 | `prizm/src/llm/rulesLoader.ts` | 项目内自动发现规则 |
| Slash 命令 | `prizm/src/llm/customCommandLoader.ts`、`slashCommandRegistry.ts`、`slashCommands.ts` | 自定义斜杠命令注册与实现 |
| 工具元数据 | `prizm/src/llm/toolMetadata.ts` | 工具元数据注册（供客户端展示） |

### 5.5 记忆与检索

| 模块 | 路径 | 职责 |
|------|------|------|
| EverMem 服务 | `prizm/src/llm/EverMemService.ts` | 与 @prizm/evermemos 集成 |
| 本地 Embedding | `prizm/src/llm/localEmbedding.ts` | 本地向量模型（如 TaylorAI/bge-micro-v2） |
| 工作区与 @ 引用 | `prizm/src/llm/workspaceResolver.ts`、`atReferenceParser.ts`、`atReferenceRegistry.ts`、`scopeInteractionParser.ts`、`scopeItemRegistry.ts` | 工作区路径与 @ 引用解析与注册 |

### 5.6 网络搜索与 Tool LLM

| 模块 | 路径 | 职责 |
|------|------|------|
| Tavily | `prizm/src/llm/tavilySearch.ts` | 网络搜索（可选，需 TAVILY_API_KEY） |
| webSearch | `prizm/src/llm/webSearch/` | 网络搜索封装 |
| toolLLM | `prizm/src/llm/toolLLM/` | 工具专用 LLM（如 workflowSubmitTool） |

### 5.7 MCP

| 模块 | 路径 | 职责 |
|------|------|------|
| MCP 服务端 | `prizm/src/mcp/` | 工具定义（`tools/`）、stdio 实现（`stdio-tools/`）、`index.ts`、`stdio-bridge.ts` |
| MCP 客户端 | `prizm/src/mcp-client/` | 连接外部 MCP 服务，配置导入（如 Claude/Cursor） |

---

## 6. 终端

| 模块 | 路径 | 职责 |
|------|------|------|
| 会话管理 | `prizm/src/terminal/TerminalSessionManager.ts` | 创建/调整大小/销毁 |
| 终端 WebSocket | `prizm/src/terminal/TerminalWebSocketServer.ts` | `/ws/terminal` 实时 I/O |
| 执行 Worker 池 | `prizm/src/terminal/ExecWorkerPool.ts` | 并行执行 |
| Shell 检测 | `prizm/src/terminal/shellDetector.ts` | PowerShell / bash / zsh |

路由：`routes/terminal.ts`（REST）；交互 I/O 走 WebSocket。

---

## 7. 搜索

| 模块 | 路径 | 职责 |
|------|------|------|
| 搜索索引 | `prizm/src/search/searchIndexService.ts` | SQLite 索引 |
| MiniSearch / 关键词 / ripgrep | `miniSearchRunner.ts`、`keywordSearch.ts`、`ripgrepSearch.ts` | 多引擎统一搜索 |

---

## 8. 工作流、任务、定时与 Cron

| 模块 | 路径 | 职责 |
|------|------|------|
| 工作流引擎 | `prizm/src/core/workflowEngine/` | 定义与执行、恢复、linkedActionExecutor、与 task 集成 |
| 后台会话 | `prizm/src/core/backgroundSession/` | 后台会话管理 |
| Cron | `prizm/src/core/cronScheduler/` | Cron 调度 |
| 日程提醒 | `prizm/src/core/scheduleReminder/` | 日程与提醒 |
| 工具权限清理 | `prizm/src/core/toolPermission/` | 工具权限生命周期清理 |

路由：`routes/workflow.ts`、`routes/task.ts`、`routes/schedule.ts`、`routes/cron.ts`。  
说明：工作流执行模型为**串行**，步骤按数组顺序执行；图中边表示顺序与数据依赖，不表示分支或并行。

---

## 9. 路由与 API

### 9.1 路由组织方式

- 每个领域一个工厂函数：`createXxxRoutes(router, adapter?)`，在 `server.ts` 中挂载。
- 复杂领域拆子目录（如 `routes/agent/`：sessions、chat、metadata、audit、chatCore 等）。

### 9.2 路由与端点概览

| 前缀/路径 | 认证 | 说明 |
|-----------|------|------|
| `/health` | 否 | 健康检查（含 embedding 状态） |
| `/auth/*` | 否 | 注册、列出/撤销客户端、列出 scope |
| `/agent/*` | 是 | 会话、流式聊天（SSE）、元数据、slash-commands、capabilities 等 |
| `/agent/audit`、`/agent/locks` | 是 | 审计查询、锁列表与强制释放 |
| `/todo/*`、`/documents/*`、`/clipboard/*` | 是 + scope | 待办、文档、剪贴板 |
| `/memory/*`、`/search/*`、`/files/*` | 是 + scope | 记忆、统一搜索、工作区文件 |
| `/terminal/*` | 是 | 终端会话 |
| `/commands/*`、`/skills/*`、`/agent-rules/*` | 是 | 自定义命令、技能、Agent 规则 |
| `/workflow/*`、`/task/*`、`/schedule/*`、`/cron/*` | 是（部分 + scope） | 工作流、后台任务、日程、Cron |
| `/feedback/*` | 是 + scope | 反馈 CRUD 与统计 |
| `/notify`、`/settings/*`、`/embedding/*`、`/mcp-config/*` | 是 | 通知、设置、Embedding、MCP 配置 |
| `/browser/*` | 是 | 浏览器控制（relay 等），见 `routes/browser.ts` |
| `/dashboard/*` | Panel 豁免 | Vue 面板 SPA |

WebSocket：`ws://.../ws`（事件）、`ws://.../ws/terminal`（终端）。

---

## 10. 设置与配置

| 模块 | 路径 | 职责 |
|------|------|------|
| Agent 工具配置 | `prizm/src/settings/agentToolsStore.ts` | 工具开关与权限 |
| 服务端配置 | `prizm/src/settings/serverConfigStore.ts`、`serverConfigTypes.ts` | LLM 多套配置等 |
| 类型 | `prizm/src/settings/types.ts` | 设置相关类型 |

---

## 11. 服务端入口与生命周期

| 模块 | 路径 | 职责 |
|------|------|------|
| 应用创建与挂载 | `prizm/src/server.ts` | Express 应用、中间件、路由挂载、HTTP 监听 |
| 入口导出 | `prizm/src/index.ts` | 对外导出 createPrizmServer 等 |
| 配置 / 错误 / ID / Scope | `config.ts`、`errors.ts`、`id.ts`、`scopeUtils.ts`、`scopes.ts`、`logger.ts` |

**启动顺序（概要）**：HTTP 监听 → 各服务 init（EverMem、TokenUsage、Lock、Audit、Feedback）→ 工作流/任务/Cron/提醒初始化 → EventBus 处理器注册 → WebSocket（事件 + 终端）→ WS 桥接注册。  
**关闭顺序**：终端 WS 与终端管理 → 事件 WS → EventBus 清理 → 各 DB 关闭 → HTTP 关闭。

---

## 12. Electron 客户端（@prizm/electron-client）

- **技术**：Electron 40、Vite、React 19、Ant Design、Zustand。
- **主进程**：`electron/main.ts`；与渲染进程通过 IPC 通信。
- **前端**：`src/` — 页面（Agent、协作、设置、工作台、首页等）、组件（Agent 会话、工具卡片、文档编辑、工作流、反馈、BrowserPlayground 等）、状态、上下文、样式。

---

## 13. Client Core（@prizm/client-core）

| 模块 | 路径 | 职责 |
|------|------|------|
| HTTP 客户端 | `src/http/client.ts` + `mixins/*` | 对服务端 REST 的封装（agent、documents、todo、clipboard、memory、search、files、terminal、workflow、task、schedule、feedback、settings、embedding、auth、audit、locks、checkpoint、toolLLM 等） |
| WebSocket | `src/websocket/connection.ts` | 事件订阅与推送 |
| 终端 | `src/terminal/TerminalConnection.ts` | 终端连接封装 |
| Agent 工具展示 | `src/agent/ToolMetadataRegistry.ts`、`ToolRenderRegistry.ts` | 工具元数据与渲染注册 |

---

## 14. Shared（@prizm/shared）

| 模块 | 路径 | 职责 |
|------|------|------|
| 常量 / 领域 / 事件 / 认证 / WebSocket / Scope / 资源引用 | `src/constants.ts`、`domain.ts`、`events.ts`、`auth.ts`、`websocket.ts`、`scopes.ts`、`resourceRef.ts` | 跨包类型与常量 |

---

## 15. 其他包与目录

### 15.1 @prizm/evermemos（packages/evermemos）

- **MemoryManager**：记忆创建、更新、删除。
- **RetrievalManager**：检索与 rank fusion。
- **extractors/**：多种记忆抽取器（Unified、Foresight、Profile、EventLog、Episode 等）。
- **storage/**：SQLite 元数据、LanceDB 向量。
- **utils/**：rank fusion、查询扩展、LLM 工具等。

### 15.2 @prizm/prizm-stagehand（packages/prizm-stagehand）

- 通过 CDP URL（relay）连接已有浏览器，复用 Stagehand 的 act/observe/extract。
- 模型配置由 Prizm 服务端提供；导出 `createPrizmStagehandSession` 与类型。

### 15.3 Panel（prizm/panel）

- Vue 3 + Vite，静态资源由 Express 在 `/dashboard/` 提供。
- 视图：Overview、Agent、Documents、Tasks、Notes、Clipboard、Audit、TokenStats、Permissions、Settings、Notify 等。

### 15.4 Website（website）

- 独立 Vite 应用，用于官网/落地页，含 i18n（如 en/zh）与静态资源。

### 15.5 服务层与杂项

- **services/**：如 `todoService.ts` 等业务封装。
- **scripts/**、**types/**：脚本与共享类型（若存在）。

---

## 16. 数据持久化汇总

| 类型 | 路径/说明 |
|------|------------|
| 客户端 | `.prizm-data/clients.json` |
| Scope 数据 | `.prizm-data/scopes/{scope}/` 下各类型 .md 单文件 |
| 资源锁 | `.prizm-data/resource_locks.db` |
| 审计 | `.prizm-data/agent_audit.db` |
| Token 用量 | `.prizm-data/token_usage.db` |
| 搜索索引 | `.prizm-data/search_index.db` |
| 反馈 | `.prizm-data/feedback.db` |

---

## 17. 相关文档

- **CLAUDE.md**（根目录与 `prizm/`）：开发命令、环境变量、架构树、API 端点、生命周期等速查。
- **docs/skill-module-architecture.md**：Skill 模块全链路与接口。
- **docs/workflow-system.md**、**docs/bg-session-task-system.md** 等：工作流与后台任务细节。
- **EverMemOS/docs/ARCHITECTURE.md**：EverMemOS（Python）架构，与 Prizm 服务端通过 @prizm/evermemos 集成。

---

*文档按功能模块整理，与当前代码库同步；新增路由、核心模块或领域事件时请同步更新 CLAUDE.md 对应章节（参见 .cursor/rules/doc-sync-reminder.mdc）。*
