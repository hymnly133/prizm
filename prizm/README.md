# Prizm Server

Prizm 效率服务器 - 为桌面效率工具提供 HTTP API 访问接口。

## 管理面板

启动服务后访问 `http://127.0.0.1:4127/dashboard/` 打开内置管理面板，可可视化管理便签、发送通知等。Panel 请求自带 `X-Prizm-Panel: true`，无需 API Key。

## 鉴权与 Scope

- **外部 API 调用**需先注册获取 API Key：`POST /auth/register`，body: `{ name, requestedScopes }`
- 请求时通过 `Authorization: Bearer <key>`、`X-Prizm-Api-Key` 或 `?apiKey=` 传入
- **Scope**：数据按 scope 隔离，通过 `X-Prizm-Scope` 或 `?scope=` 指定，默认 `default`
- **本地开发**：`PRIZM_AUTH_DISABLED=1` 可关闭鉴权

## 功能特性

- **便签管理**：便签和分组的 CRUD 操作
- **通知信号**：发送通知事件（下游实现具体展示）
- **Agent 对话**：LLM 驱动的会话与流式对话（支持智谱、小米 MiMo、OpenAI 兼容接口）

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
import type { IStickyNotesAdapter, INotificationAdapter } from '@prizm/server'

// 创建适配器，对接主应用的服务
const notesAdapter: IStickyNotesAdapter = {
  async getAllNotes() {
    return await myApp.stickyNotesManager.getAllNotes()
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
  notes: notesAdapter,
  notification: notificationAdapter
})

await server.start()
```

## LLM 提供商配置

Agent 对话功能根据环境变量自动选择 LLM 提供商，**默认优先小米 MiMo**，优先级：**小米 MiMo > 智谱 > OpenAI 兼容**。

| 提供商 | 环境变量 | 可选模型变量 | 默认模型 |
|--------|----------|-------------|----------|
| 小米 MiMo（默认优先） | `XIAOMIMIMO_API_KEY` | `XIAOMIMIMO_MODEL` | mimo-v2-flash |
| 智谱 AI (GLM) | `ZHIPU_API_KEY` | `ZHIPU_MODEL` | glm-4-flash |
| OpenAI 兼容 | `OPENAI_API_KEY` | `OPENAI_MODEL` | gpt-4o-mini |
| OpenAI 兼容 | `OPENAI_API_URL` | - | <https://api.openai.com/v1> |

配置任一提供商的 API Key 后，Agent 将自动使用对应服务。未配置时返回提示消息。

### 小米 MiMo 配置步骤

1. **注册并申请 API**：打开 [MiMo Studio](https://aistudio.xiaomimimo.com/)，使用小米账号登录，在页面底部进入「API Platform」提交 API 申请。
2. **获取 API Key**：申请通过后，在平台中创建 API Key 并复制。
3. **设置环境变量**：

   ```bash
   # Windows PowerShell
   $env:XIAOMIMIMO_API_KEY = "你的API-Key"

   # 方式一：项目根目录 .env 文件（推荐）
   XIAOMIMIMO_API_KEY=你的API-Key

   # 方式二：Linux/macOS 当前会话
   export XIAOMIMIMO_API_KEY=你的API-Key
   ```

   服务器启动时会自动加载 `.env`（项目根 `d:\prizm\.env` 或 `prizm/.env` 均可）。

4. **可选**：指定模型 `XIAOMIMIMO_MODEL`（默认 `mimo-v2-flash`）。

## API 文档

### 健康检查

```bash
GET /health
```

### 便签管理

```bash
# 获取所有便签
GET /notes

# 获取单条便签
GET /notes/:id

# 创建便签
POST /notes
Content-Type: application/json
{
  "content": "便签内容",
  "groupId": "可选分组ID"
}

# 更新便签
PATCH /notes/:id
{
  "content": "新内容"
}

# 删除便签
DELETE /notes/:id

# 获取所有分组
GET /notes/groups

# 创建分组
POST /notes/groups
{ "name": "分组名称" }

# 更新分组
PATCH /notes/groups/:id
{ "name": "新名称" }

# 删除分组
DELETE /notes/groups/:id
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

# 创建便签
curl -X POST http://127.0.0.1:4127/notes \
  -H "Content-Type: application/json" \
  -d '{"content":"测试便签"}'

# 获取所有便签
curl http://127.0.0.1:4127/notes

# 发送通知
curl -X POST http://127.0.0.1:4127/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"测试通知","body":"Hello from Prizm"}'

# Agent 对话（需先注册获取 API Key，并配置 LLM 环境变量）
curl -X POST "http://127.0.0.1:4127/agent/sessions" \
  -H "Authorization: Bearer <apiKey>" \
  -H "X-Prizm-Scope: default"
```

## 适配器接口

Prizm 通过适配器模式与底层服务解耦，你需要实现以下接口：

- `IStickyNotesAdapter` - 便签管理
- `INotificationAdapter` - 通知发送
- `IAgentAdapter` - Agent 会话与 LLM 对话（可选）

默认提供的适配器：

- `DefaultStickyNotesAdapter` - 内存存储
- `DefaultNotificationAdapter` - 控制台输出
- `DefaultAgentAdapter` - 基于 ScopeStore 的会话管理，LLM 由环境变量选型（智谱 / 小米 MiMo / OpenAI 兼容）

## 许可证

MIT
