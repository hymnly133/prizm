# Prizm Server 使用说明

面向使用 Prizm Server 的开发者、Agent 及终端用户。

## 概述

Prizm Server 是一个 HTTP API 服务器，为桌面效率工具提供：

- **便签管理**：按 scope 隔离的便签与分组 CRUD
- **SMTC**：系统媒体传输控制（播放、暂停、切换等）
- **通知**：发送系统通知
- **Dashboard**：Web 可视化管理界面

默认监听 `http://127.0.0.1:4127`，支持鉴权与 scope 数据隔离。

---

## 快速开始

### 安装与启动

```bash
# 在项目根目录
cd prizm
yarn build          # 构建（含 Dashboard）
yarn start          # 启动服务，默认端口 4127

# 或指定端口
node cli.js 5000

# 监听所有网卡（便于 WSL/Docker 访问）
yarn start -- --host 0.0.0.0
node cli.js --host 0.0.0.0
```

### 关闭鉴权（本地开发）

```bash
PRIZM_AUTH_DISABLED=1 yarn start
```

### 访问 Dashboard

启动后浏览器访问：

- 根路径：`http://127.0.0.1:4127/` → 自动重定向到 Dashboard
- Dashboard：`http://127.0.0.1:4127/dashboard/`

---

## 鉴权

### 需要 API Key 的路径

以下路径**需要**有效 API Key（或豁免条件）：

- `/notes`、`/notes/*`
- `/smtc/*`
- `/notify`

### 豁免路径（无需 API Key）

| 路径 | 说明 |
|------|------|
| `/` | 根路径，重定向到 Dashboard |
| `/health` | 健康检查 |
| `/dashboard`、`/dashboard/*` | Dashboard 静态资源 |
| `/auth`、`/auth/*` | 注册、客户端列表、scope 列表等 |

### 豁免请求头

请求头包含 `X-Prizm-Panel: true` 时，视为 Dashboard 请求，**豁免鉴权**。

### 传入 API Key 的三种方式

1. **Authorization 头**：`Authorization: Bearer <apiKey>`
2. **自定义头**：`X-Prizm-Api-Key: <apiKey>`
3. **查询参数**：`?apiKey=<apiKey>`

### 错误响应

- `401`：缺少或无效 API Key
- 成功时正常返回 JSON

---

## Scope（数据隔离）

便签和分组按 **scope** 隔离存储。不同 scope 的数据互不影响。

### 指定 Scope

1. **请求头**：`X-Prizm-Scope: <scope>`
2. **查询参数**：`?scope=<scope>`

### 默认值

未指定时使用 `default`。

### 权限校验

- 客户端注册时可声明 `allowedScopes`（如 `["default", "notes"]`）
- 若声明 `*`，可访问任意 scope
- 请求的 scope 必须在 `allowedScopes` 内，否则回退到 `default`

---

## API 参考

### Base URL

默认：`http://127.0.0.1:4127`

下文示例均以此为基础，且假定已配置 API Key（如通过 `X-Prizm-Api-Key`）。

---

### 1. Auth API

#### 注册客户端

```http
POST /auth/register
Content-Type: application/json

{
  "name": "My Client",
  "requestedScopes": ["default"]
}
```

- `name`：必填，客户端名称
- `requestedScopes`：可选，数组，如 `["default"]`、`["default", "notes"]` 或 `["*"]` 表示全部权限

**响应**（201）：

```json
{
  "clientId": "abc123...",
  "apiKey": "prizm_xxxxxxxx..."
}
```

> ⚠️ `apiKey` 仅返回一次，请妥善保存。吊销后需重新注册。

#### 列出 scope

```http
GET /auth/scopes
```

**响应**：`{ "scopes": ["default", "notes", ...] }`

#### 列出客户端

```http
GET /auth/clients
```

**响应**：`{ "clients": [{ "clientId", "name", "allowedScopes", "createdAt" }, ...] }`

#### 吊销客户端

```http
DELETE /auth/clients/:clientId
```

**响应**：204（无内容）

---

### 2. Notes API（便签）

所有便签与分组接口均受 scope 影响，通过 `X-Prizm-Scope` 或 `?scope=` 指定。

#### 便签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /notes | 获取所有便签 |
| GET | /notes/:id | 获取单条便签 |
| POST | /notes | 创建便签 |
| PATCH | /notes/:id | 更新便签 |
| DELETE | /notes/:id | 删除便签 |

**创建/更新请求体示例**：

```json
{
  "content": "便签内容",
  "groupId": "可选分组ID",
  "imageUrls": ["可选图片URL"],
  "fileRefs": [{ "path": "文件路径" }]
}
```

#### 分组

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /notes/groups | 获取所有分组 |
| POST | /notes/groups | 创建分组 |
| PATCH | /notes/groups/:id | 更新分组 |
| DELETE | /notes/groups/:id | 删除分组 |

**创建分组**：`{ "name": "分组名称" }`

---

### 3. SMTC API（媒体控制）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /smtc/play | 播放 |
| POST | /smtc/pause | 暂停 |
| POST | /smtc/stop | 停止 |
| POST | /smtc/skip-next | 下一首 |
| POST | /smtc/skip-previous | 上一首 |
| POST | /smtc/toggle-play-pause | 切换播放/暂停 |
| GET | /smtc/current | 当前会话 |
| GET | /smtc/sessions | 所有会话 |

请求体可选：`{ "sourceAppId": "应用ID" }`，用于指定媒体源。

---

### 4. 通知 API

```http
POST /notify
Content-Type: application/json

{
  "title": "通知标题",
  "body": "可选内容"
}
```

---

### 5. 健康检查

```http
GET /health
```

**响应**：`{ "status": "ok", "service": "prizm-server", "timestamp": 1234567890 }`

---

## Dashboard

Dashboard 提供：

- **概览**：服务状态、便签数、scope 数、客户端数
- **权限管理**：注册、查看、吊销客户端
- **便签**：按 scope 管理便签
- **SMTC**：媒体控制
- **通知**：发送测试通知

Dashboard 请求自动带 `X-Prizm-Panel: true`，无需 API Key。

---

## 面向 Agent 的指南

### 1. 首次接入流程

1. 使用 `POST /auth/register` 注册，获取 `clientId` 和 `apiKey`
2. 将 `apiKey` 安全保存，后续请求均需携带

### 2. 请求示例（curl）

```bash
# 健康检查（无需 Key）
curl http://127.0.0.1:4127/health

# 注册客户端
curl -X POST http://127.0.0.1:4127/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"MyAgent","requestedScopes":["default"]}'

# 获取便签（需 Key）
curl http://127.0.0.1:4127/notes \
  -H "X-Prizm-Api-Key: prizm_xxx"

# 指定 scope
curl http://127.0.0.1:4127/notes \
  -H "X-Prizm-Api-Key: prizm_xxx" \
  -H "X-Prizm-Scope: default"

# 创建便签
curl -X POST http://127.0.0.1:4127/notes \
  -H "Content-Type: application/json" \
  -H "X-Prizm-Api-Key: prizm_xxx" \
  -H "X-Prizm-Scope: default" \
  -d '{"content":"测试便签"}'
```

### 3. 错误处理

| 状态码 | 含义 | 建议 |
|--------|------|------|
| 401 | 缺少/无效 API Key | 检查 Key 或重新注册 |
| 404 | 资源不存在 | 确认 ID 与 scope |
| 503 | 适配器不可用 | 服务端未配置对应功能 |
| 500 | 服务端错误 | 查看服务端日志 |

### 4. 环境变量

| 变量 | 说明 |
|------|------|
| `PRIZM_AUTH_DISABLED=1` | 关闭鉴权，所有 API 无需 Key |

### 5. 从 WSL 连接

WSL 2 与 Windows 有独立网络栈，`127.0.0.1` 在 WSL 中指向 WSL 自身。根据 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/wsl/networking)，有两种方案：

#### 方案 A：Mirrored 模式（推荐，Windows 11 22H2+）

启用后 WSL 可直接用 `localhost` 访问 Windows 服务，无需改 Prizm 配置。

1. 创建/编辑 `%USERPROFILE%\.wslconfig`：

```ini
[wsl2]
networkingMode=mirrored
```

1. **以管理员身份**打开 PowerShell，执行后重启 WSL：

```powershell
# 允许 Hyper-V 防火墙入站（WSL 2.0.9+ 默认开启需配置）
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow

# 重启 WSL 使 .wslconfig 生效
wsl --shutdown
```

1. 重新打开 WSL，然后直接访问：

```bash
curl http://127.0.0.1:4127/health
```

#### 方案 B：NAT 模式（默认）+ 放行防火墙

若使用默认 NAT 模式，需同时满足：Prizm 监听 `0.0.0.0`、放行 Windows 防火墙、用 Windows 主机 IP 访问。

**步骤 1**：在 Windows 上启动 Prizm 并监听所有网卡：

```bash
yarn start -- --host 0.0.0.0
# 或
node cli.js --host 0.0.0.0
```

**步骤 2**：在 Windows 上以**管理员身份**打开 PowerShell，放行 WSL 访问端口 4127：

```powershell
# 针对 vEthernet (WSL) 虚拟网卡放行 4127
New-NetFirewallRule -DisplayName "Prizm WSL Inbound" -InterfaceAlias "vEthernet (WSL)" -Direction Inbound -Protocol TCP -LocalPort 4127 -Action Allow
```

若 `vEthernet (WSL)` 找不到，可改用：

```powershell
New-NetFirewallRule -DisplayName "Prizm WSL Inbound" -Direction Inbound -Protocol TCP -LocalPort 4127 -Action Allow -Profile Private
```

**步骤 3**：在 WSL 中获取 Windows 主机 IP 并访问：

```bash
# 获取 Windows 主机 IP（Microsoft 推荐方式）
WIN_IP=$(ip route show | grep -i default | awk '{ print $3}')
echo $WIN_IP   # 例如 172.30.96.1
curl http://$WIN_IP:4127/health
```

或使用 `/etc/resolv.conf` 中的 nameserver：

```bash
WIN_IP=$(grep nameserver /etc/resolv.conf | awk '{print $2}')
curl http://$WIN_IP:4127/health
```

**若仍连接被拒绝**，检查：

- Prizm 是否以 `--host 0.0.0.0` 启动
- Windows 防火墙规则是否已创建且生效
- 在 Windows 本机用 `curl http://127.0.0.1:4127/health` 是否正常

### 6. 数据持久化

- 客户端信息：`.prizm-data/clients.json`
- 便签与分组：`.prizm-data/scopes/{scope}.json`
- 重启后数据保留

---

## 附录：完整 curl 示例

```bash
BASE=http://127.0.0.1:4127
KEY="prizm_your_api_key_here"

# 健康检查
curl $BASE/health

# 注册
curl -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","requestedScopes":["*"]}'

# 便签 CRUD
curl $BASE/notes -H "X-Prizm-Api-Key: $KEY"
curl -X POST $BASE/notes -H "Content-Type: application/json" -H "X-Prizm-Api-Key: $KEY" \
  -d '{"content":"Hello"}'
curl -X PATCH $BASE/notes/xxx -H "Content-Type: application/json" -H "X-Prizm-Api-Key: $KEY" \
  -d '{"content":"Updated"}'
curl -X DELETE $BASE/notes/xxx -H "X-Prizm-Api-Key: $KEY"

# SMTC
curl -X POST $BASE/smtc/play -H "Content-Type: application/json" -H "X-Prizm-Api-Key: $KEY" -d '{}'
curl $BASE/smtc/current -H "X-Prizm-Api-Key: $KEY"

# 通知
curl -X POST $BASE/notify \
  -H "Content-Type: application/json" \
  -H "X-Prizm-Api-Key: $KEY" \
  -d '{"title":"Test","body":"Hello"}'
```
