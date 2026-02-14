# Prizm MCP 完整说明

Prizm 通过 MCP（Model Context Protocol）向 Cursor、LobeChat 等 Agent 暴露本机统一上下文（便签、任务、剪贴板、文档），使其可以读取和操作桌面数据。

## 前置条件

1. **Prizm 服务必须在本机运行**，默认 `http://127.0.0.1:4127`
2. 若启用鉴权，需配置 API Key（Dashboard 中创建）

---

## 方式一：Cursor（stdio 桥接）

Cursor 通过 stdio 与 MCP 通信。使用 `stdio-bridge` 将 Cursor 的 stdio 请求转发到本机 Prizm HTTP API。

### 1. 构建

```bash
cd prizm
yarn build
```

### 2. 配置 Cursor MCP

在 Cursor 的 MCP 配置中加入：

**Windows（用户级）**：`%APPDATA%\Cursor\User\globalStorage\cursor.mcp\mcp.json`  
**macOS/Linux**：`~/.cursor/mcp.json` 或 Cursor 设置中的 MCP 配置

```json
{
  "mcpServers": {
    "prizm": {
      "command": "node",
      "args": ["D:/prizm/prizm/dist/mcp/stdio-bridge.js"],
      "env": {
        "PRIZM_URL": "http://127.0.0.1:4127",
        "PRIZM_API_KEY": "your-api-key-if-enabled",
        "PRIZM_SCOPE": "online"
      }
    }
  }
}
```

- `args` 中的路径改为你本机 `prizm/dist/mcp/stdio-bridge.js` 的绝对路径
- 若未启用鉴权（`PRIZM_AUTH_DISABLED=1`），可省略 `PRIZM_API_KEY` 或留空
- `PRIZM_SCOPE`：操作的数据 scope，默认 `online`。参见下方 Scope 说明

### 3. 重启 Cursor

保存配置后重启 Cursor，或在 MCP 设置中刷新。工具列表中应出现 `prizm_list_notes`、`prizm_create_note`、`prizm_list_todo_list` 等。

---

## 方式二：HTTP/SSE 直连（LobeChat、Claude Desktop 等）

Prizm 主服务内置 MCP HTTP 端点，支持 Streamable HTTP transport。适用：

- 本机 LobeChat / Claude Desktop
- 云端 LobeChat（需将本机暴露到公网）

### 本机直连

若 LobeChat 运行在本机，配置 MCP 服务器为：

- **URL**：`http://127.0.0.1:4127/mcp`
- **带 scope**：`http://127.0.0.1:4127/mcp?scope=online`（在 URL 查询参数中指定 scope）
- **Headers**（若启用鉴权）：`Authorization: Bearer <api_key>`
- **Scope**：未传 `?scope=` 时使用服务端 `PRIZM_MCP_SCOPE` 环境变量；再未设则 `online`

LobeChat 的 MCP 配置格式取决于其版本，一般为 URL + 自定义 headers。

### 云端 LobeChat：内网穿透方案

云端 LobeChat 无法直接访问本机。需将本地 Prizm 暴露到可达地址，可选以下三种方案：

| 方案 | 特点 | 适用场景 |
|-----|------|----------|
| **ngrok** | 安装即用、零配置；内置流量检查 (localhost:4040)；免费版随机 URL，付费可固定域名 | 快速临时测试、Webhook 调试 |
| **Cloudflare Tunnel** | 免费、稳定；临时隧道路径无需账号；可与 Cloudflare 防火墙、CDN 集成 | 长期稳定暴露、企业级安全 |
| **Tailscale** | 端到端加密、零信任；不暴露公网，仅同一 Tailscale 网络可访问；需两端都安装 Tailscale | 多设备私有网络、长期安全访问 |

#### 方案 A：ngrok

```bash
# 安装 ngrok 后
ngrok http 4127
```

- 公网 URL 示例：`https://xxx.ngrok-free.app`
- MCP 配置：`https://xxx.ngrok-free.app/mcp?scope=online`
- 特点：易用、有 Web 流量检查界面 (`http://localhost:4040`)，免费版 URL 每次重启变化

#### 方案 B：Cloudflare Tunnel

```bash
# 安装 cloudflared 后（无需登录即可使用临时隧道）
cloudflared tunnel --url http://127.0.0.1:4127
```

- 公网 URL 示例：`https://xxx.trycloudflare.com`
- MCP 配置：`https://xxx.trycloudflare.com/mcp?scope=online`
- 特点：免费、稳定；可与 Cloudflare 账号绑定后使用固定域名、防火墙等

#### 方案 C：Tailscale

1. 本机与云端 LobeChat 所在服务器均安装 Tailscale，加入同一账号/网络
2. 本机启动 Prizm 并监听所有网卡：`PRIZM_HOST=0.0.0.0 yarn start` 或 `yarn start -- --host 0.0.0.0`（默认 127.0.0.1 仅本机可访问）
3. 在 LobeChat 服务器上通过本机 Tailscale IP 访问：`http://<本机Tailscale-IP>:4127/mcp?scope=online`

- 特点：不暴露公网，端到端加密；需两端都在 Tailscale 网络中

**安全提示**：使用 ngrok 或 Cloudflare Tunnel 公网暴露时务必启用鉴权，并尽量只在需要时开启隧道。

---

## Scope 说明

Scope 用于隔离不同工作场景的数据（便签、任务、剪贴板等）。MCP 会话在建立时确定 scope，所有工具调用均在该 scope 内执行。

| Scope | 说明 |
|-------|------|
| `default` | 默认工作区，用于通用工作场景 |
| `online` | 用户实时上下文，Electron 客户端常驻显示此 scope 的 TODO 和便签。推荐作为 MCP/Agent 的默认操作范围 |
| 自定义 | 任意字符串，用于隔离特定项目或场景 |

**配置方式：**

- **stdio-bridge**：环境变量 `PRIZM_SCOPE`，默认 `online`
- **HTTP/SSE MCP**：连接时 URL 查询参数 `?scope=xxx`；未传时使用服务端 `PRIZM_MCP_SCOPE` 环境变量；再未设则 `online`
- **服务端默认**：`PRIZM_MCP_SCOPE=online` 可设为首选 scope

---

## 可用工具一览

### 便签 (Notes)

| 工具名 | 说明 | 参数 |
|-------|------|------|
| `prizm_list_notes` | 列出便签，可选关键词过滤 | `q` (string, 可选)：关键词 |
| `prizm_search_notes` | 按关键词搜索便签内容 | `query` (string)：搜索关键词 |
| `prizm_create_note` | 创建便签 | `content` (string)：便签内容 |
| `prizm_get_note` | 根据 ID 获取单条便签详情 | `id` (string)：便签 ID |
| `prizm_update_note` | 更新便签内容 | `id` (string)：便签 ID；`content` (string, 可选)：新内容；`groupId` (string, 可选)：分组 ID |
| `prizm_delete_note` | 删除便签 | `id` (string)：便签 ID |

### 任务 (TODO 列表)

每个 scope 一个 TODO 列表，含若干 item。item 有 `id`、`status`(todo|doing|done)、`title`、`description`(可选)。

| 工具名 | 说明 | 参数 |
|-------|------|------|
| `prizm_list_todo_list` | 列出 TODO 列表，返回 `{ title, items }`，每个 item 含 id、status、title、description | 无 |
| `prizm_update_todo_list` | 更新 TODO 列表 | `title` (string, 可选)：列表标题；`items` (array, 可选)：全量替换；`updateItem` (object, 可选)：单条更新 `{ id, status?, title?, description? }`，id 来自 list；`updateItems` (array, 可选)：批量更新。仅改状态时推荐用 updateItem |

### 文档 (Documents)

| 工具名 | 说明 | 参数 |
|-------|------|------|
| `prizm_list_documents` | 列出文档（正式信息文档） | `q` (string, 可选)：关键词过滤标题或内容 |
| `prizm_create_document` | 创建文档 | `title` (string)：文档标题；`content` (string, 可选)：正文，支持 Markdown |
| `prizm_get_document` | 根据 ID 获取单条文档详情 | `id` (string)：文档 ID |
| `prizm_update_document` | 更新文档 | `id` (string)：文档 ID；`title` (string, 可选)；`content` (string, 可选)：支持 Markdown |
| `prizm_delete_document` | 删除文档 | `id` (string)：文档 ID |

### 剪贴板 (Clipboard)

| 工具名 | 说明 | 参数 |
|-------|------|------|
| `prizm_get_clipboard` | 获取剪贴板历史 | `limit` (number, 可选)：返回条数，默认 10 |
| `prizm_add_clipboard_item` | 向剪贴板历史新增一条记录 | `content` (string)：内容；`type` (string, 可选)：`text` / `image`，默认 `text` |
| `prizm_get_clipboard_item` | 根据 ID 获取单条剪贴板记录 | `id` (string)：剪贴板记录 ID |
| `prizm_delete_clipboard_item` | 删除剪贴板历史中的一条记录 | `id` (string)：剪贴板记录 ID |

### 通知 (Notification)

| 工具名 | 说明 | 参数 |
|-------|------|------|
| `prizm_notice` | 主动发送通知到已连接的客户端（Electron 等），Agent 完成操作后可通知用户 | `title` (string)：通知标题；`body` (string, 可选)：通知正文 |

---

## 工具与 HTTP API 对应关系

| MCP 工具 | HTTP 方法 | 路径 |
|----------|----------|------|
| prizm_list_notes | GET | /notes?scope=xxx |
| prizm_search_notes | GET | /notes?q=xxx&scope=xxx |
| prizm_create_note | POST | /notes |
| prizm_get_note | GET | /notes/:id |
| prizm_update_note | PATCH | /notes/:id |
| prizm_delete_note | DELETE | /notes/:id |
| prizm_list_todo_list | GET | /tasks?scope=xxx |
| prizm_update_todo_list | PATCH | /tasks（body 含 updateItem/updateItems/items） |
| prizm_list_documents | GET | /documents?scope=xxx |
| prizm_create_document | POST | /documents |
| prizm_get_document | GET | /documents/:id |
| prizm_update_document | PATCH | /documents/:id |
| prizm_delete_document | DELETE | /documents/:id |
| prizm_get_clipboard | GET | /clipboard/history?scope=xxx |
| prizm_add_clipboard_item | POST | /clipboard |
| prizm_get_clipboard_item | GET | /clipboard/history?limit=500 (需 scope)，再从结果中查找 |
| prizm_delete_clipboard_item | DELETE | /clipboard/:id |
| prizm_notice | POST | /notify |

---

## MCP 客户端配置（Agent 调用外部 MCP 服务器）

Prizm Agent 对话支持**调用**用户配置的外部 MCP 服务器，使 LLM 能够使用 GitHub、文件系统、搜索等外部工具。

### 配置方式

**方式一：Electron 客户端设置页**

1. 打开 Prizm Electron 客户端 → 设置
2. 在「MCP 服务器（Agent 工具）」区块添加服务器
3. 填写 ID、名称、传输类型、URL 或 stdio 命令
4. 点击「测试」验证连接

**方式二：HTTP API**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /mcp/servers | 列出 MCP 服务器配置 |
| POST | /mcp/servers | 添加 MCP 服务器 |
| PATCH | /mcp/servers/:id | 更新配置 |
| DELETE | /mcp/servers/:id | 删除配置 |
| GET | /mcp/servers/:id/tools | 获取某服务器的工具列表（测试连接） |

需鉴权（Bearer Token 或 X-Prizm-Api-Key）。

### 配置格式

```json
{
  "id": "prizm-local",
  "name": "Prizm 本机",
  "transport": "streamable-http",
  "url": "http://127.0.0.1:4127/mcp?scope=online",
  "headers": { "Authorization": "Bearer your-api-key" },
  "enabled": true
}
```

**传输类型：**

- `streamable-http`：远程 HTTP 服务器（推荐）
- `sse`：HTTP+SSE（已弃用，仅作回退；连接时会优先尝试 Streamable HTTP）
- `stdio`：本地进程，需配置 `stdio.command` 和 `stdio.args`

**stdio 示例：**

```json
{
  "id": "filesystem",
  "name": "文件系统",
  "transport": "stdio",
  "stdio": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]
  },
  "enabled": true
}
```

### 存储位置

配置持久化于 `.prizm-data/mcp-servers.json`。

### 对话中的使用

- Agent 对话默认启用 MCP（`mcpEnabled: true`）
- 发送消息时，若已配置 MCP 服务器，LLM 会收到工具列表
- LLM 可请求调用工具，服务端执行后继续生成
- 请求体可传 `mcpEnabled: false` 禁用 MCP

---

## 故障排查

1. **stdio-bridge 启动失败**：确认 `yarn build` 已执行，`dist/mcp/stdio-bridge.js` 存在
2. **Cursor 看不到工具**：检查 `args` 路径是否正确，Prizm 服务是否在运行
3. **401 鉴权错误**：在 `env` 中正确设置 `PRIZM_API_KEY`，或在 Dashboard 中创建新 Key
4. **云端连接超时**：确认隧道（ngrok/Cloudflare/Tailscale）正常运行，防火墙未拦截
5. **scope 无权限**：客户端注册时需在 `requestedScopes` 中包含目标 scope，或使用 `*` 获取全部 scope

---

## 环境变量汇总

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PRIZM_URL | stdio-bridge 连接的服务地址 | `http://127.0.0.1:4127` |
| PRIZM_API_KEY | API Key，用于鉴权 | 空 |
| PRIZM_SCOPE | stdio-bridge 操作的 scope | `online` |
| PRIZM_MCP_SCOPE | HTTP MCP 未传 scope 时的默认值 | `online` |
