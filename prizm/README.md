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
```

## 适配器接口

Prizm 通过适配器模式与底层服务解耦，你需要实现以下接口：

- `IStickyNotesAdapter` - 便签管理
- `INotificationAdapter` - 通知发送

默认提供的适配器：

- `DefaultStickyNotesAdapter` - 内存存储
- `DefaultNotificationAdapter` - 控制台输出

## 许可证

MIT
