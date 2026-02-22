# Prizm 用户手册

面向最终用户与首次部署者，说明如何安装、运行和日常使用 Prizm。开发者与架构细节请参阅 [CLAUDE.md](../CLAUDE.md)。

---

## 1. 概述

**Prizm** 是面向桌面的效率工具平台，提供 HTTP API 与 WebSocket 实时推送，支持便签、待办、剪贴板、文档、通知等能力，并可通过 MCP 与 Cursor、LobeChat 等 AI 工具打通。

- **本机优先**：数据可完全落在本地（`.prizm-data`），可选本地 Embedding，无需上云即可做记忆与检索。
- **与 AI 工作流打通**：MCP 向 Cursor、LobeChat 暴露便签/待办/文档/剪贴板；内置 Agent 对话与工作流编排（多步 + 审批）。
- **多工作区（Scope）**：`default` / `online` 等数据隔离，适合多项目或多设备语义；MCP/Agent 推荐默认使用 `online`。
- **生产向能力**：资源锁、审计日志、WebSocket 实时推送；可仅用 API，也可嵌入现有应用（适配器模式）。

---

## 2. 安装与运行

### 基本步骤

```bash
git clone <repo-url>
cd prizm
yarn install
yarn dev:server
```

浏览器打开 **http://127.0.0.1:4127/dashboard/** 即可使用管理面板，**无需配置 .env** 即可完成第一次体验。若要用 **Agent 对话**，需在服务端设置中配置 LLM（见 [配置参考](configuration.md)）。

### 环境配置（可选）

推荐将 **`prizm/.env.example`** 复制为 **`prizm/.env`**（与示例同目录），并按需填写端口、数据目录、LLM API Key 等。若在项目根目录提供 `.env`，部分工具也会加载。

### 首次运行检查

- **端口**：默认 4127。若被占用，可在项目根执行 `yarn kill-port`（Windows），或设置环境变量 `PRIZM_PORT` 使用其他端口。
- **Node 版本**：建议使用当前 LTS 版本。
- **数据目录**：默认 `.prizm-data`（相对当前工作目录）；若希望固定路径，可设置 `PRIZM_DATA_DIR` 为绝对路径（如 `D:\prizm\.prizm-data`），避免换目录启动后数据「看起来」重置。

---

## 3. 使用方式概览

| 方式 | 说明 |
|------|------|
| **仅服务端** | 浏览器访问 `/dashboard/` 或直接调 HTTP API。仅服务端即可完成第一次体验，无需安装 Electron。 |
| **桌面端** | 执行 `yarn dev:electron`，常驻桌面使用便签、待办、文档、Agent、工作流等；默认连接本机 `http://127.0.0.1:4127`。首次使用若启用鉴权，需在 Dashboard 或客户端内注册 API Key。 |
| **与 Cursor 集成** | 配置 MCP stdio-bridge（路径、`PRIZM_URL`、`PRIZM_API_KEY`、`PRIZM_SCOPE`），详见 [MCP 连接](#6-mcp-连接)。 |
| **与 LobeChat 集成** | HTTP 直连 `http://127.0.0.1:4127/mcp` 或通过内网穿透，见 [prizm/MCP-CONFIG.md](../prizm/MCP-CONFIG.md)。 |

除上表外，还支持**工作流编排**（多步自动化 + 审批）、**本地向量检索**（Embedding，默认启用）、**Agent 审批与 MCP 扩展**。详见 [工作流系统](workflow-system.md)、[本地 Embedding](local-embedding.md)。

---

## 4. Dashboard（管理面板）

- **访问地址**：服务启动后访问 `http://127.0.0.1:4127/dashboard/`（或根路径自动重定向）。
- **功能**：概览、便签、任务、文档、剪贴板、Agent 会话、Token 用量等数据呈现，以及系统级配置（权限、Agent 工具、LLM、MCP 等）。
- **定位**：Dashboard 是**系统控制台**，用于全面查看数据与改配置；**日常使用**推荐以 **Electron 客户端**为主（工作台、文档编辑、Agent 协作、工作流、记忆与用量等）。

Dashboard 请求自带 `X-Prizm-Panel: true`，无需 API Key。

---

## 5. 桌面客户端（Electron）

- **启动**：在项目根目录执行 `yarn dev:electron`（开发模式）。生产环境可使用构建后的桌面应用。
- **连接**：默认连接本机 `http://127.0.0.1:4127`。可在客户端内「设置 → 服务端配置」修改地址与端口。
- **API Key**：若服务端启用鉴权，首次使用需在 **Dashboard**（`/dashboard/`）或 **客户端设置** 中注册并填入 API Key。
- **入口**：工作台、文档、Agent 对话、工作流、记忆与用量等均在客户端内提供完整交互与实时同步。

---

## 6. MCP 连接

Prizm 通过 MCP 向 Cursor、LobeChat 等暴露本机上下文（便签、任务、剪贴板、文档）。

- **Cursor**：使用 stdio 桥接，在 Cursor 的 MCP 配置中指定 `prizm/dist/mcp/stdio-bridge.js` 路径，并在 `env` 中设置 `PRIZM_URL`、`PRIZM_API_KEY`（鉴权开启时）、`PRIZM_SCOPE`（推荐 `online`）。
- **LobeChat**：本机直连时配置 MCP 服务器 URL 为 `http://127.0.0.1:4127/mcp`（可加 `?scope=online`）；若启用鉴权，需在连接配置中传入 `Authorization: Bearer <api_key>`。

完整步骤、故障排查与云端 LobeChat 内网穿透方案见 [prizm/MCP-CONFIG.md](../prizm/MCP-CONFIG.md)。

---

## 7. Agent、工作流与记忆

- **Agent**：LLM 驱动的流式对话，支持智谱、小米 MiMo、OpenAI 兼容等。需至少配置一个 LLM API Key（见 [配置总览](configuration.md)）。未配置时，Agent 会提示需要配置。
- **工作流**：多步骤自动化流水线，支持人工审批、超时、事件触发等。定义与运行见 [工作流系统](workflow-system.md)；Electron 客户端提供可视化编辑。
- **记忆**：本地 Embedding 默认启用，用于记忆与检索；三层记忆架构见 [prizm/MEMORY_SYSTEM.md](../prizm/MEMORY_SYSTEM.md)。本地向量模型说明见 [本地 Embedding](local-embedding.md)。

---

## 8. 配置参考

- **完整配置项与配置方式**：见 [配置总览](configuration.md)。环境变量以 [prizm/.env.example](../prizm/.env.example) 为权威清单。
- **常用变量**：`PRIZM_PORT`、`PRIZM_HOST`、`PRIZM_DATA_DIR`、`PRIZM_AUTH_DISABLED`、`XIAOMIMIMO_API_KEY` / `ZHIPU_API_KEY` / `OPENAI_API_KEY` 等，见根 [README 环境变量](../README.md#环境变量) 或配置总览。
- **Scope**：`default` 为通用；`online` 与 Electron 常驻展示一致，推荐 MCP/Agent 默认使用 `online`。

更多术语说明见 [术语表](glossary.md)。

---

## 9. 常见问题（FAQ）

- **端口 4127 被占用怎么办？**  
  在项目根执行 `yarn kill-port`（Windows），或设置 `PRIZM_PORT` 使用其他端口后重启服务端。

- **未配置 LLM 时 Agent 提示什么？**  
  Agent 会提示需要配置至少一个 LLM API Key（小米 MiMo、智谱或 OpenAI 兼容）。不配置也可正常使用面板与 API（便签、待办、文档等）。

- **.env 应该放在哪里？**  
  推荐 **`prizm/.env`**（与 `prizm/.env.example` 同目录）。若在项目根目录存在 `.env`，部分环境也会加载。

- **Scope 选 default 还是 online？**  
  日常与 Electron 一致用 **online**；通用脚本或仅 API 可用 **default**。MCP 未传 scope 时由服务端 `PRIZM_MCP_SCOPE` 决定（默认 `online`）。

- **Electron 连不上服务端？**  
  确认服务端已启动（如 `yarn dev:server`），且客户端设置中的地址与端口正确（默认 `http://127.0.0.1:4127`）。若启用鉴权，需在 Dashboard 或客户端内配置有效 API Key。

---

更多 API 与集成说明见 [prizm/README.md](../prizm/README.md)、[prizm/USAGE.md](../prizm/USAGE.md)。
