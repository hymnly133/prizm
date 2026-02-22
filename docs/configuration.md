# Prizm 配置总览

本文档汇总 Prizm 的配置项、作用及配置方式，便于快速判断「改什么、去哪改」。**环境变量以 [prizm/.env.example](../prizm/.env.example) 为权威清单**，此处仅做分类与说明。

## 配置方式说明

| 配置方式 | 说明 |
|----------|------|
| **环境变量** | 在 `prizm/.env` 或 shell 中设置；推荐与 `.env.example` 同目录的 `prizm/.env` |
| **Dashboard** | 内置管理面板（`/dashboard/`）设置页，可配置端口、主机、数据目录、鉴权等；部分项需重启服务端生效 |
| **客户端设置** | Electron 客户端 → 设置 → 服务端配置（连接地址、API Key 等） |
| **文件路径** | Agent Rules、工作流定义等存于指定目录或通过 API 管理 |

环境变量优先于 Dashboard/客户端中的可视化配置。

---

## 配置项一览

### 服务与运行

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_PORT` | 服务端口 | 环境变量、Dashboard | 4127 |
| `PRIZM_HOST` | 监听地址 | 环境变量、Dashboard | 127.0.0.1 |
| `PRIZM_DATA_DIR` | 数据根目录（便签、待办、文档、Agent 会话、锁、审计等持久化数据均在此下） | 环境变量、Dashboard | .prizm-data |
| `PRIZM_LOG_LEVEL` | 日志级别 | 环境变量 | info |

修改端口/主机/数据目录后需重启服务端。

### 鉴权

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_AUTH_DISABLED` | 关闭鉴权（仅建议本地开发使用） | 环境变量 | 未设置（鉴权开启） |
| API Key | 客户端访问 API / MCP / Electron 连接 | Dashboard 注册、`POST /auth/register` | - |

### Agent（LLM）

LLM 由**服务端设置**中的「LLM 配置」管理，支持多套配置（OpenAI 兼容 / Anthropic / Google）。在 **Dashboard 设置页**或 **Electron 客户端 → 设置 → 服务端配置** 中添加配置项：填写 API Key、Base URL（仅 OpenAI 兼容）、默认模型，并选择默认配置即可。不再通过环境变量配置 LLM。完整清单见 [prizm/.env.example](../prizm/.env.example)。

### Agent 上下文与压缩

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS` | 单次请求注入到 Agent 的 scope 上下文（便签/待办/文档摘要）最大字符数 | 环境变量 | 4000 |
| `PRIZM_FULL_CONTEXT_TURNS` | 完全上下文轮数（压缩参数 A） | 环境变量、agent-tools 等 | 4 |
| `PRIZM_CACHED_CONTEXT_TURNS` | 缓存轮数（压缩参数 B） | 环境变量、agent-tools 等 | 3 |

上下文压缩详见 [prizm/CONTEXT_COMPRESSION.md](../prizm/CONTEXT_COMPRESSION.md)，**多数用户使用默认即可**。

### 本地 Embedding

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_EMBEDDING_ENABLED` | 是否启用本地 embedding | 环境变量 | true |
| `PRIZM_EMBEDDING_MODEL` | HuggingFace 模型 ID | 环境变量 | TaylorAI/bge-micro-v2 |
| `PRIZM_EMBEDDING_CACHE_DIR` | 模型缓存目录 | 环境变量 | {dataDir}/models |
| `PRIZM_EMBEDDING_MAX_CONCURRENCY` | 最大并发推理数 | 环境变量 | 1 |

详见 [本地 Embedding](local-embedding.md)。

### 搜索

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `TAVILY_API_KEY` | Tavily 网络搜索 API key（启用 Agent 网络搜索工具） | 环境变量 | - |

可选；未配置则无网络搜索工具。

### Skills 市场

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_SKILLKIT_API_URL` | SkillKit 市场 API 根地址 | 环境变量 | https://skillkit.sh/api |
| `GITHUB_TOKEN` | GitHub Token（提高 skill 搜索与拉取限流上限） | 环境变量 | - |

### MCP

| 配置项 | 作用 | 配置方式 | 默认值 |
|--------|------|----------|--------|
| `PRIZM_MCP_SCOPE` | HTTP MCP 未传 `scope` 时的默认 scope | 环境变量（服务端） | online |
| `PRIZM_URL` / `PRIZM_API_KEY` / `PRIZM_SCOPE` | Cursor stdio-bridge 连接用 | Cursor `mcp.json` 的 `env` | - |

MCP 完整说明见 [prizm/MCP-CONFIG.md](../prizm/MCP-CONFIG.md)。

### Agent Rules 与工作流

| 配置项 | 作用 | 配置方式 |
|--------|------|----------|
| 用户级规则 | 全局 Agent 行为规则 | `.prizm-data/rules/*.md`、API `/agent-rules`、Dashboard |
| Scope 级规则 | 按工作区生效的规则 | `{scopeRoot}/.prizm/rules/*.md`、API |
| 工作流定义 | 工作流编排 | API `/workflow`、Electron 客户端工作流页 |

---

## 快速参考

- **只想改端口/数据目录/鉴权/LLM**：使用 `prizm/.env` 或 Dashboard 即可。
- **调优长对话或 token 预算**：见 [CONTEXT_COMPRESSION.md](../prizm/CONTEXT_COMPRESSION.md) 与 `.env.example` 中的 `PRIZM_FULL_CONTEXT_TURNS`、`PRIZM_CACHED_CONTEXT_TURNS`。
- **Scope 推荐**：日常与 Electron 一致用 `online`；通用或脚本可用 `default`。MCP 未传 scope 时由服务端 `PRIZM_MCP_SCOPE` 决定（默认 `online`）。
