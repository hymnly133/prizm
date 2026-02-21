# Prizm

**Prizm** 是面向桌面的效率工具平台，提供 HTTP API 与 WebSocket 实时推送，支持便签、待办、番茄钟、剪贴板、文档、通知等能力，并可通过 MCP（Model Context Protocol）与 Cursor、LobeChat 等 AI 工具打通。

### 特点一览

- **本机优先**：数据可完全落在本地（`.prizm-data`），可选本地 Embedding，无需上云即可做记忆与检索。
- **与 AI 工作流打通**：MCP 向 Cursor、LobeChat 暴露便签/待办/文档/剪贴板；内置 Agent 对话与工作流编排（多步 + 审批）。
- **多工作区（Scope）**：`default` / `online` 等数据隔离，适合多项目或多设备语义；MCP/Agent 推荐默认使用 `online`。
- **生产向能力**：资源锁、审计日志、WebSocket 实时推送；可仅用 API，也可嵌入现有应用（适配器模式）。

---

## 一分钟体验

```bash
git clone <repo-url>
cd prizm
yarn install
yarn dev:server
```

浏览器打开 **http://127.0.0.1:4127/dashboard/** 即可使用管理面板（便签、待办、文档等），**无需配置 .env**。  
若要用 **Agent 对话**，需至少配置一个 LLM API Key（见下方「环境变量」）。端口占用可 `yarn kill-port` 或设置 `PRIZM_PORT`。

---

## 项目结构

```
prizm/
├── prizm/                    # @prizm/server - HTTP API 服务端
│   ├── src/                  # 服务端源码
│   │   ├── adapters/         # 适配器（便签、通知、待办、文档等）
│   │   ├── routes/           # Express 路由
│   │   ├── mcp/              # MCP 服务（stdio 桥接、HTTP 端点）
│   │   ├── websocket/        # WebSocket 实时推送
│   │   └── ...
│   └── panel/                # Vue 3 管理面板（/dashboard/）
├── prizm-shared/             # @prizm/shared - 共享类型与常量
├── prizm-client-core/        # @prizm/client-core - 客户端 SDK
├── prizm-electron-client/    # @prizm/electron-client - Electron 桌面客户端
```

## 文档

- [服务端 README](prizm/README.md) - API 与集成说明  
- [MCP 配置](prizm/MCP-CONFIG.md) - Cursor / LobeChat 连接  
- [工作流系统](docs/workflow-system.md) - 工作流引擎说明  
- [本地 Embedding](docs/local-embedding.md) - 本地向量模型集成说明  
- [CLAUDE.md](CLAUDE.md) - 架构与开发指引（面向贡献者）  
- [开源发布 UX 审计](docs/OPEN_SOURCE_UX_AUDIT.md) - 快速上手 / 使用 / 配置 / 特点可见性审计（维护用）

## 快速开始

### 1. 安装依赖

```bash
yarn install
```

可选：复制 **`prizm/.env.example`** 为 **`prizm/.env`** 并按需填写（端口、数据目录、LLM API Key 等）。推荐把 .env 放在 `prizm/` 目录下与示例同目录；若在项目根目录提供 `.env`，部分环境也会加载。

### 2. 启动服务端

```bash
yarn dev:server
# 或
yarn build:server && yarn start
```

服务默认运行在 `http://127.0.0.1:4127`，访问 `/dashboard/` 打开管理面板。

### 3. 启动桌面客户端（可选）

```bash
yarn dev:electron
```

Electron 客户端连接服务端，接收 WebSocket 推送（通知、待办更新等），并展示便签、待办、文档等。默认连接本机 `http://127.0.0.1:4127`；首次使用若启用鉴权，需在 Dashboard 或客户端内注册 API Key。

### 使用方式概览

| 方式 | 说明 |
|------|------|
| **仅服务端** | 浏览器访问 `/dashboard/` 或直接调 HTTP API（见下方 API 概览） |
| **桌面端** | `yarn dev:electron`，常驻桌面使用便签、待办、文档、Agent |
| **与 Cursor 集成** | 配置 MCP stdio-bridge（路径、`PRIZM_URL`、`PRIZM_API_KEY`），详见 [MCP-CONFIG](prizm/MCP-CONFIG.md) |
| **与 LobeChat 集成** | HTTP 直连 `http://127.0.0.1:4127/mcp` 或通过内网穿透，见 [MCP-CONFIG](prizm/MCP-CONFIG.md) |

除下表能力外，还支持**工作流编排**（多步自动化 + 审批）、**本地向量检索**（Embedding，默认启用）、**Agent 审批与 MCP 扩展**。详见 [工作流系统](docs/workflow-system.md)、[本地 Embedding](docs/local-embedding.md)。

## 开发命令

| 命令 | 说明 |
|------|------|
| `yarn install` | 安装所有 workspace 依赖 |
| `yarn build` | 构建服务端 + Electron 客户端 |
| `yarn build:server` | 仅构建服务端 |
| `yarn build:electron` | 仅构建 Electron 客户端 |
| `yarn dev:server` | 服务端开发模式（watch + 热重载） |
| `yarn dev:electron` | Electron 客户端开发模式 |
| `yarn start` | 生产模式启动服务端 |
| `yarn test` | 运行测试 |

### 服务端子命令（`cd prizm`）

| 命令 | 说明 |
|------|------|
| `yarn dev` | 服务端 + 面板 watch 模式 |
| `yarn dev:panel` | 仅面板开发（Vite 热重载） |
| `yarn build:panel` | 仅构建面板 |
| `yarn kill-port` | 结束占用 4127 端口的进程（Windows） |
| `yarn mcp:stdio` | 运行 MCP stdio 桥接（供 Cursor 等使用） |

## 核心能力

| 模块 | 说明 |
|------|------|
| **便签** | 便签与分组 CRUD，支持 Markdown |
| **待办** | TODO 列表，状态流转（todo/doing/done） |
| **番茄钟** | 计时会话与统计 |
| **剪贴板** | 历史记录与同步 |
| **文档** | 富文本文档管理 |
| **通知** | 发送通知到已连接客户端 |
| **Agent** | LLM 驱动的流式对话（智谱 / 小米 MiMo / OpenAI 兼容） |
| **MCP** | 向 Cursor、LobeChat 暴露便签、待办、剪贴板等工具 |

## API 概览

| 路径 | 说明 |
|------|------|
| `GET /health` | 健康检查（无需鉴权） |
| `POST /auth/register` | 注册客户端，获取 API Key |
| `GET/POST/PATCH/DELETE /notes` | 便签 CRUD |
| `GET/POST/PATCH/DELETE /todo`、`/todo/items` | 待办列表 |
| `POST /notify` | 发送通知 |
| `GET/POST /documents` | 文档 CRUD |
| `GET/POST /clipboard` | 剪贴板 |
| `POST /pomodoro/start` | 番茄钟 |
| `GET/POST /agent/sessions` | Agent 会话 |
| `GET /dashboard/*` | 管理面板（`X-Prizm-Panel: true` 免鉴权） |

详细 API 见 [prizm/README.md](prizm/README.md)。

## MCP 集成

Prizm 通过 MCP 向 AI 工具暴露本机上下文：

- **Cursor**：使用 stdio 桥接，配置 `prizm/dist/mcp/stdio-bridge.js`
- **LobeChat**：HTTP 直连 `http://127.0.0.1:4127/mcp`

工具示例：`prizm_list_notes`、`prizm_create_note`、`prizm_list_todo_list`、`prizm_update_todo_list`、`prizm_notice` 等。

配置说明见 [prizm/MCP-CONFIG.md](prizm/MCP-CONFIG.md)。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PRIZM_PORT` | 服务端口 | 4127 |
| `PRIZM_HOST` | 监听地址 | 127.0.0.1 |
| `PRIZM_DATA_DIR` | 数据根目录（便签、待办、文档、会话、锁、审计等均在此下） | .prizm-data |
| `PRIZM_AUTH_DISABLED` | 关闭鉴权（开发用） | - |
| `PRIZM_LOG_LEVEL` | 日志级别 | info |

**LLM（Agent）**：默认优先小米 MiMo，优先级 XIAOMIMIMO > ZHIPU > OPENAI

| 变量 | 说明 |
|------|------|
| `XIAOMIMIMO_API_KEY` | 小米 MiMo |
| `ZHIPU_API_KEY` | 智谱 AI |
| `OPENAI_API_KEY` | OpenAI 兼容 |

## 技术栈

- **服务端**：Node.js、Express 5、TypeScript、WebSocket
- **面板**：Vue 3、Vite
- **Electron 客户端**：Electron、React 19、Vite、Ant Design
- **共享**：Scope 隔离、适配器模式、JWT 风格鉴权

## 许可证

MIT
