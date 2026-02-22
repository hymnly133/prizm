# Prizm Server

Prizm 效率服务器 - 为桌面效率工具提供 HTTP API 访问接口。详细使用与部署见 [USAGE.md](USAGE.md)，与 Cursor/LobeChat 集成见 [MCP-CONFIG.md](MCP-CONFIG.md)。

## 管理面板

启动服务后访问 `http://127.0.0.1:4127/dashboard/` 打开内置管理面板，可查看概览、文档、待办、剪贴板、Agent 会话、审计、设置等并发送通知。Panel 请求自带 `X-Prizm-Panel: true`，无需 API Key。

## 鉴权与 Scope

- **外部 API 调用**需先注册获取 API Key：`POST /auth/register`，body: `{ name, requestedScopes }`
- 请求时通过 `Authorization: Bearer <key>`、`X-Prizm-Api-Key` 或 `?apiKey=` 传入
- **Scope**：数据按 scope 隔离，通过 `X-Prizm-Scope` 或 `?scope=` 指定，默认 `default`
- **本地开发**：`PRIZM_AUTH_DISABLED=1` 可关闭鉴权

## 功能特性

- **文档管理**：文档 CRUD（Markdown，按 Scope 隔离），可与 Agent 共享上下文
- **待办与剪贴板**：待办列表、剪贴板历史 CRUD
- **通知信号**：发送通知事件（下游实现具体展示）
- **Agent 对话**：LLM 驱动的会话与流式对话（LLM 由服务端设置中的「LLM 配置」管理，支持 OpenAI 兼容 / Anthropic / Google）

## 安装

```bash
# 作为 workspace 依赖（在主项目中）
yarn install

# 构建
cd prizm
yarn build
```

## 快速开始

### 独立运行（使用默认适配器）

```typescript
import { createPrizmServer, createDefaultAdapters } from '@prizm/server'

// 创建默认适配器（内存存储 + 控制台日志）
const adapters = createDefaultAdapters()

// 创建并启动服务器
const server = createPrizmServer(adapters, {
  port: 4127,
  host: '127.0.0.1'
})

await server.start()
console.log('Prizm Server running at', server.getAddress())
```

### 集成到主应用

```typescript
import { createPrizmServer } from '@prizm/server'
import type { IDocumentsAdapter, INotificationAdapter } from '@prizm/server'

// 创建适配器，对接主应用的服务
const documentsAdapter: IDocumentsAdapter = {
  async getAllDocuments(scope) {
    return await myApp.documentsManager.getAll(scope)
  },
  // ... 其他方法
}

const notificationAdapter: INotificationAdapter = {
  notify(title, body) {
    myApp.showNotification(title, body)
  }
}

// 启动服务器
const server = createPrizmServer({
  documents: documentsAdapter,
  notification: notificationAdapter
})

await server.start()
```

## LLM 配置

Agent 对话使用的 LLM 由**服务端设置**中的「LLM 配置」管理，支持多套配置（OpenAI 兼容 / Anthropic / Google）。在 **Dashboard 设置页**或 **Electron 客户端 → 设置 → 服务端配置** 中添加配置项，填写 API Key、Base URL（仅 OpenAI 兼容）、默认模型，并选择默认配置即可。无需再通过环境变量配置 LLM。

## API 文档

### 健康检查

```bash
GET /health
```

### 文档管理

```bash
# 列出文档
GET /documents?scope=default

# 获取单篇文档
GET /documents/:id?scope=default

# 创建文档
POST /documents
Content-Type: application/json
{ "title": "标题", "content": "内容" }

# 更新文档
PATCH /documents/:id
{ "title": "新标题", "content": "新内容" }

# 删除文档
DELETE /documents/:id
```

### 通知

```bash
# 发送通知
POST /notify
Content-Type: application/json
{
  "title": "通知标题",
  "body": "通知内容（可选）"
}
```

### Agent 对话

```bash
# 创建会话
POST /agent/sessions
# 需 scope，见 X-Prizm-Scope 或 ?scope=

# 列出会话
GET /agent/sessions?scope=default

# 获取会话及消息
GET /agent/sessions/:id?scope=default

# 删除会话
DELETE /agent/sessions/:id?scope=default

# 流式对话（SSE）
POST /agent/sessions/:id/messages
Content-Type: application/json
{ "content": "用户消息" }
# 响应为 text/event-stream
```

## 测试示例

```bash
# 健康检查
curl http://127.0.0.1:4127/health

# 发送通知
curl -X POST http://127.0.0.1:4127/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"测试通知","body":"Hello from Prizm"}'

# Agent 对话（需先注册获取 API Key，并在服务端设置中配置 LLM）
curl -X POST "http://127.0.0.1:4127/agent/sessions" \
  -H "Authorization: Bearer <apiKey>" \
  -H "X-Prizm-Scope: default"
```

## 适配器接口

Prizm 通过适配器模式与底层服务解耦，你需要实现以下接口：

- `IDocumentsAdapter` - 文档 CRUD（可选）
- `ITodoListAdapter` - 待办列表（可选）
- `IClipboardAdapter` - 剪贴板历史（可选）
- `INotificationAdapter` - 通知发送
- `IAgentAdapter` - Agent 会话与 LLM 对话（可选）

默认提供的适配器：

- `DefaultDocumentsAdapter` - Markdown 文件存储
- `DefaultTodoListAdapter` - Markdown 文件存储
- `DefaultClipboardAdapter` - Markdown 文件存储
- `DefaultNotificationAdapter` - 控制台输出
- `DefaultAgentAdapter` - 基于 ScopeStore 的会话管理，LLM 由服务端设置中的「LLM 配置」管理

## 许可证

本仓库采用 [PolyForm Noncommercial 1.0.0](../LICENSE) 许可证，仅供非商业使用。
