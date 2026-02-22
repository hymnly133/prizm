# Prizm

> **Finally, Agents WORKS WITH you.**

**Prizm** 是一个 **Agent 协作环境**（Agent Collaborative Environment）：面向通用生产力与日常效率的桌面工作集成平台。在这里，Agent 与用户同权、共同管理你的知识库、任务与工作流——无需你是程序员，也不必在多个工具之间来回切换。

---

## 为什么是 Prizm？

- **For You**：让 Agent 为你搭建与管理知识库、整理零散资料、规划任务、创建可复用的工作流；一个桌面入口，搞定日常效率。
- **For Agent**：为智能体提供高度集成的上下文环境——知识库、文档、待办、剪贴板、终端、MCP——在各种层级协作，精确为你提供服务。
。

设计上，你可以把它理解为 **Agentic Obsidian**（智能体与你共同管理知识库）、**通用个人生产力 AI IDE**（不垂直编程，而是你的日常效率中枢），或 **与知识库深度绑定的自动化流水线**（工作流 + 定时与事件驱动，形成闭环）。

---

## 核心模块

| 模块 | 说明 |
|------|------|
| **知识库** | 文档、待办、文件；支持 Markdown，按工作区（Scope）隔离，可与 Agent 共享上下文。 |
| **智能体与拓展** | 内置完善的 Agent 对话功能与管理；Agent Skills、MCP 扩展，并支持作为MCP服务器像其他工具暴露上下文 |
| **本地能力** | 终端、文件操作、剪贴板、通知等，Agent 均可调用。 |
| **工作流** | 将 Agent 编排为可复用的流水线，规范化输入输出，支持审批、定时与事件触发。 |
| **记忆** | 本地 Embedding + 三层记忆架构，无需上云即可做持久化记忆与检索。 |
| **审计与交互** | 资源锁、操作审计、WebSocket 实时推送；可审计、可审批，生产可用。 |
| **Token 管理** | 用量统计与可见，便于控制成本。 |

数据本机优先（`.prizm-data`），可选仅用 API 或嵌入现有应用（适配器模式）。

---

## 一分钟体验

```bash
git clone <repo-url>
cd prizm
yarn install
yarn dev:server
```

浏览器打开 **<http://127.0.0.1:4127/dashboard/>** 即可使用管理面板（便签、待办、文档等），**无需配置 .env**。  
若要使用 **Agent 对话**，需在服务端设置中配置 LLM（见 [配置总览](docs/configuration.md)）。端口占用可 `yarn kill-port` 或设置 `PRIZM_PORT`。

---

## 文档与用户手册

- **快速上手**：本 README、[用户手册](docs/USER_GUIDE.md)
- **使用与集成**：[服务端 README](prizm/README.md)、[使用说明](prizm/USAGE.md)、[MCP 配置](prizm/MCP-CONFIG.md)
- **进阶**：[工作流系统](docs/workflow-system.md)、[本地 Embedding](docs/local-embedding.md)、[反馈系统](docs/feedback-system.md)、[配置总览](docs/configuration.md)
- **开发与架构**：[CLAUDE.md](CLAUDE.md)、[开源发布 UX 审计](docs/OPEN_SOURCE_UX_AUDIT.md)
- **术语表**：[glossary.md](docs/glossary.md)

---

## 快速开始

**环境配置**：推荐将 `.env` 放在 **`prizm/.env`**（与 `prizm/.env.example` 同目录）；若项目根目录存在 `.env`，部分工具也会加载。

### 1. 安装依赖

```bash
yarn install
```

可选：复制 **`prizm/.env.example`** 为 **`prizm/.env`** 并按需填写（端口、数据目录等）。

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

Electron 客户端连接服务端，接收 WebSocket 推送（通知、待办更新等），并展示便签、待办、文档、Agent、工作流等。默认连接本机 `http://127.0.0.1:4127`；首次使用若启用鉴权，需在 Dashboard 或客户端内注册 API Key。

### 使用方式概览

| 方式 | 说明 |
|------|------|
| **仅服务端** | 浏览器访问 `/dashboard/` 或直接调 HTTP API（见下方 API 概览） |
| **桌面端** | `yarn dev:electron`，常驻桌面使用便签、待办、文档、Agent、工作流 |
| **作为MCP服务器** | 配置 MCP stdio-bridge（路径、`PRIZM_URL`、`PRIZM_API_KEY`），详见 [MCP-CONFIG](prizm/MCP-CONFIG.md) |

---

## 项目结构

```
prizm/
├── prizm/                    # @prizm/server - HTTP API 服务端
│   ├── src/                  # 服务端源码（适配器、路由、MCP、WebSocket 等）
│   └── panel/                # Vue 3 管理面板（/dashboard/）
├── prizm-shared/             # @prizm/shared - 共享类型与常量
├── prizm-client-core/        # @prizm/client-core - 客户端 SDK
├── prizm-electron-client/    # @prizm/electron-client - Electron 桌面客户端
```

---

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

服务端子命令（`cd prizm`）：`yarn dev` / `yarn dev:panel` / `yarn build:panel` / `yarn kill-port` / `yarn mcp:stdio`。

---

## API 概览

| 路径 | 说明 |
|------|------|
| `GET /health` | 健康检查（无需鉴权） |
| `POST /auth/register` | 注册客户端，获取 API Key |
| `GET/POST/PATCH/DELETE /todo`、`/todo/items` | 待办列表 |
| `POST /notify` | 发送通知 |
| `GET/POST /documents` | 文档 CRUD |
| `GET/POST /clipboard` | 剪贴板 |
| `GET/POST /agent/sessions` | Agent 会话 |
| `GET /dashboard/*` | 管理面板（`X-Prizm-Panel: true` 免鉴权） |

详细 API 见 [prizm/README.md](prizm/README.md)。

---

## MCP 集成

Prizm 通过 MCP 向 Cursor、LobeChat 等暴露本机上下文（便签、待办、文档、剪贴板等）：

- **Cursor**：使用 stdio 桥接，配置 `prizm/dist/mcp/stdio-bridge.js`，在 `env` 中设置 `PRIZM_URL`、`PRIZM_API_KEY`、`PRIZM_SCOPE`。
- **LobeChat**：HTTP 直连 `http://127.0.0.1:4127/mcp`。

配置说明见 [prizm/MCP-CONFIG.md](prizm/MCP-CONFIG.md)。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PRIZM_PORT` | 服务端口 | 4127 |
| `PRIZM_HOST` | 监听地址 | 127.0.0.1 |
| `PRIZM_DATA_DIR` | 数据根目录（便签、待办、文档、会话、锁、审计等均在此下） | .prizm-data |
| `PRIZM_AUTH_DISABLED` | 关闭鉴权（开发用） | - |
| `PRIZM_LOG_LEVEL` | 日志级别 | info |

**LLM（Agent）**：由服务端设置中的「LLM 配置」管理，支持多套配置（OpenAI 兼容 / Anthropic / Google）。完整配置项与配置方式见 [配置总览](docs/configuration.md)、[prizm/.env.example](prizm/.env.example)。

---

## 技术栈

- **服务端**：Node.js、Express 5、TypeScript、WebSocket
- **面板**：Vue 3、Vite
- **Electron 客户端**：Electron、React 19、Vite、Ant Design
- **共享**：Scope 隔离、适配器模式、JWT 风格鉴权

---

## 许可证

本仓库采用 [PolyForm Noncommercial 1.0.0](LICENSE) 许可证，仅供非商业使用。
