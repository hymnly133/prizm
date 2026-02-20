# Background Session 与 Task 系统架构

> 本文档描述重构后的 Background Session 统一架构，以及 Task 系统如何作为工具模块在其上特化。

## 设计理念

Background Session 不再是一套独立的"后台任务引擎"，而是普通会话（`AgentSession`）的一种**配置变体**。核心原则：

1. **统一数据模型** — BG session 和 interactive session 共享同一个 `AgentSession` 结构，仅以 `kind` 字段区分
2. **统一执行核心** — 两者都通过 `chatCore()` 执行对话，BG 只是传入不同的 skip 标志
3. **统一存储路径** — 所有 session 存储在同一个 `scopeStore`，没有独立的 BG 数据层
4. **Task 系统是工具层** — `prizm_spawn_task` / `prizm_task_status` / `prizm_set_result` 作为标准 LLM 工具，通过 session 接口与 BG session 交互

## 数据模型

```typescript
interface AgentSession {
  id: string
  scope: string
  messages: AgentMessage[]

  // ─── BG 特有字段（kind='interactive' 时均为 undefined）───
  kind?: 'interactive' | 'background'
  bgMeta?: BgSessionMeta       // 触发方式、父会话、标签、模型等
  bgStatus?: BgStatus          // pending → running → completed/failed/timeout/cancelled
  bgResult?: string            // 由 prizm_set_result 写入的执行结果
  startedAt?: number
  finishedAt?: number

  // ─── 通用字段 ───
  chatStatus?: 'idle' | 'chatting'
  llmSummary?: string
  grantedPaths?: string[]
  checkpoints?: SessionCheckpoint[]
  createdAt: number
  updatedAt: number
}

interface BgSessionMeta {
  triggerType: 'tool_spawn' | 'api' | 'cron' | 'event_hook'
  parentSessionId?: string     // tool_spawn 时指向父会话
  label?: string
  model?: string               // 可指定廉价模型
  timeoutMs?: number           // 默认 600,000ms (10min)
  autoCleanup?: boolean
  announceTarget?: { sessionId: string; scope: string }
  memoryPolicy?: SessionMemoryPolicy
  depth?: number               // 嵌套深度，根=0
}

type BgStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'interrupted'
```

**要点**：`kind` 字段向后兼容——老数据中没有此字段的 session 默认视为 `interactive`。

## 模块分层

```
┌─────────────────────────────────────────────────────┐
│                    LLM 工具层                        │
│  prizm_spawn_task · prizm_task_status · prizm_set_result │
│                 (taskTools.ts)                        │
└──────────────┬──────────────────────┬────────────────┘
               │ spawn/cancel         │ query/setResult
               ▼                      ▼
┌──────────────────────┐  ┌───────────────────────────┐
│ BackgroundSessionMgr │  │      scopeStore           │
│   (Task Orchestrator)│  │  (统一 session 数据源)      │
│                      │  │                           │
│ · 并发限制           │  │ · getScopeData().sessions │
│ · 超时控制           │  │ · saveScope()             │
│ · 取消 (abort)       │  │                           │
│ · 结果守卫           │  └───────────────────────────┘
│ · 活跃运行追踪       │             ▲
└──────────┬───────────┘             │ 读写 session
           │ 执行                     │
           ▼                         │
┌──────────────────────────────────────────────────────┐
│                    chatCore()                         │
│           统一对话核心（Interactive + BG 共享）          │
│                                                      │
│  记忆注入 → Skill/Rules → adapter.chat() → 持久化     │
└──────────────────────────────────────────────────────┘
```

## Interactive vs Background 的差异

两者走同一个 `chatCore()`，区别仅在于传入的 `ChatCoreOptions`：

| 维度 | Interactive (SSE 路由) | Background (executeRun) |
|------|----------------------|------------------------|
| 入口 | `POST /agent/sessions/:id/chat` | `bgSessionManager.trigger()` |
| 流式输出 | SSE → 客户端实时渲染 | `() => {}` 丢弃（无消费者） |
| `skipCheckpoint` | `false` | `true` |
| `skipSummary` | `false` | `true` |
| `skipPerRoundExtract` | `false` | `true` |
| `skipNarrativeBatchExtract` | `false` | `true` |
| `skipSlashCommands` | `false` | `true` |
| `skipChatStatus` | `false` | `true` |
| `systemPreamble` | 无 | 任务指令 + "必须调用 set_result" |
| `actor` | `{ type: 'user' }` | `{ type: 'system', source: 'bg-session' }` |
| 可用工具 | 全部内置工具 | 全部内置工具（完全一致） |

记忆策略由 `BgSessionMeta.memoryPolicy` 控制，默认值：

```typescript
const DEFAULT_BG_MEMORY_POLICY = {
  skipPerRoundExtract: true,      // 跳过每轮 P1 记忆抽取
  skipNarrativeBatchExtract: true, // 跳过叙述性批量抽取
  skipDocumentExtract: false,      // 保留文档记忆（BG 可能创建文档）
  skipConversationSummary: true    // 跳过对话摘要
}
```

## BackgroundSessionManager（Task Orchestrator）

位于 `prizm/src/core/backgroundSession/manager.ts`，职责精简为生命周期编排：

### 公开接口

| 方法 | 说明 |
|------|------|
| `trigger(scope, payload, meta)` | 异步触发，立即返回 `{ sessionId, promise }` |
| `triggerSync(scope, payload, meta)` | 同步触发，await 直到完成 |
| `cancel(scope, sessionId)` | 取消运行中的 BG session |
| `isRunning(sessionId)` | 检查是否在运行 |
| `activeCount` | 当前活跃数 |
| `init(adapter, limits?)` | 初始化（服务启动时调用） |
| `shutdown()` | 关闭（服务停止时调用，中断所有活跃运行） |

### 并发限制

```typescript
interface BgConcurrencyLimits {
  maxPerParent: 5    // 单个父会话最大子任务数
  maxGlobal: 10      // 系统级最大活跃 BG session 数
  maxDepth: 2        // 最大嵌套深度（防止无限递归 spawn）
}
```

### 结果守卫

BG session 的核心约束：LLM 必须调用 `prizm_set_result` 提交结果。守卫机制保证这一点：

1. `chatCore()` 执行完毕后，检查 `session.bgResult` 是否已设置
2. **未设置** → 注入提醒消息，再次调用 `chatCore()`（第二轮机会）
3. **仍未设置** → 从最后一条 assistant 消息提取文本作为 fallback 降级结果

## Task 工具层

三个 LLM 工具构成 Task 系统的用户界面：

### `prizm_spawn_task`

```
参数: task(string), mode('async'|'sync'), label?, model?, context?(JSON), 
      expected_output?, timeout_seconds?
```

- `mode='async'`：调用 `bgSessionManager.trigger()`，立即返回 sessionId
- `mode='sync'`：调用 `bgSessionManager.triggerSync()`，阻塞等待结果

### `prizm_task_status`

```
参数: action('list'|'status'|'result'|'cancel'), task_id?
```

- `list`：从 `scopeStore` 过滤 `kind=background` 且 `parentSessionId` 匹配的 session
- `status`：读取 `session.bgStatus` / `bgResult` 预览
- `result`：返回 `session.bgResult` 全文
- `cancel`：调用 `bgSessionManager.cancel()`

### `prizm_set_result`

```
参数: output(string), status?('success'|'failed'), structured_data?(string)
```

直接写入 `session.bgResult` 和 `session.bgStatus`，仅 `kind='background'` 时生效。

## 事件体系

保留 4 个生命周期事件，用于审计和客户端通知：

| 事件 | 触发时机 | 下游处理 |
|------|---------|---------|
| `bg:session.completed` | 执行成功完成 | 审计记录 + announceTarget 回传 + WS 广播 |
| `bg:session.failed` | 执行异常 | 审计记录 + WS 广播 |
| `bg:session.timeout` | 超时 | 审计记录 + WS 广播 |
| `bg:session.cancelled` | 手动取消 | 审计记录 + WS 广播 |

**announceTarget 回传**：当 `bgMeta.announceTarget` 指定了父 session，`completed` 事件会向父 session 注入一条 system 消息，告知子任务完成及其结果摘要。

## 全链路时序

### 异步任务

```
父会话 LLM
  │
  ├─ 调用 prizm_spawn_task(mode='async', task='...')
  │   │
  │   ├─ bgSessionManager.trigger()
  │   │   ├─ 检查并发限制 (maxGlobal/maxPerParent/maxDepth)
  │   │   ├─ adapter.createSession() → 新 session
  │   │   ├─ session.kind = 'background', bgStatus = 'pending'
  │   │   ├─ 启动超时定时器
  │   │   ├─ 异步启动 executeRun() ──┐
  │   │   └─ 返回 { sessionId }      │
  │   │                               │
  │   └─ 返回 "子任务已派发, ID: xxx"  │
  │                                    │
  │  （父会话继续执行其他操作）          │
  │                                    ▼
  │                          ┌─ executeRun ─────────────────┐
  │                          │ bgStatus → 'running'         │
  │                          │ chatCore(adapter, bgOptions)  │
  │                          │   ├─ 记忆注入                 │
  │                          │   ├─ adapter.chat() 流式调用   │
  │                          │   │   └─ LLM 执行工具链        │
  │                          │   │       └─ prizm_set_result  │
  │                          │   └─ 消息持久化               │
  │                          │ 结果守卫检查                   │
  │                          │ completeRun()                 │
  │                          │   └─ emit('bg:session.completed')
  │                          └──────────────────────────────┘
  │                                    │
  │                                    ▼
  │                          bgSessionHandlers
  │                            ├─ 审计记录
  │                            └─ announceTarget → 注入消息到父 session
  │
  ├─ 调用 prizm_task_status(action='status', task_id='xxx')
  │   └─ 从 scopeStore 读取 session.bgStatus
  │
  └─ 调用 prizm_task_status(action='result', task_id='xxx')
      └─ 返回 session.bgResult
```

### 同步任务

```
父会话 LLM
  │
  └─ 调用 prizm_spawn_task(mode='sync', task='...')
      │
      ├─ bgSessionManager.triggerSync()
      │   └─ trigger() + await promise
      │       └─ ... 同上 executeRun 流程 ...
      │           └─ completeRun() → resolve(promise)
      │
      └─ 返回 "子任务完成(success)\n会话 ID: xxx\n耗时: 1234ms\n---\n{结果内容}"
```

## 实时观察（Lazy Observer）

支持中途查看运行中 BG session 的流式输出，采用按需订阅 SSE 模式。

### 架构

```
┌──────────┐  GET /agent/sessions/:id/observe   ┌──────────────┐
│  客户端   │ ──────── SSE 连接 ──────────────→  │ observe 路由  │
│ (查看BG)  │ ←──── 回放 + 实时 chunks ───────  │  注册 handler │
└──────────┘                                     └──────┬───────┘
                                                        │ register
                                                        ▼
                                              ┌─────────────────┐
                                              │ observerRegistry │
                                              │ Map<sessionId,  │
                                              │ {buffer,handlers}│
                                              └────────┬────────┘
                                                       │ dispatch
                                                       ▼
                                              executeRun → chatCore
```

### ObserverRegistry

位于 `core/backgroundSession/observerRegistry.ts`：

| 方法 | 说明 |
|------|------|
| `startSession(id)` | executeRun 开始时调用，初始化缓存 |
| `dispatch(id, chunk)` | chatCore chunk handler 中调用，缓存 + 转发 |
| `endSession(id, info)` | completeRun/failRun 时调用，通知所有观察者 |
| `register(id, callbacks)` | 观察者注册：先回放缓存 chunks，再接收实时流 |
| `unregister(id, callbacks)` | 观察者断开 |

**关键特性**：
- 无观察者时，`dispatch` 仅做一次 `Map.get` + `buffer.push`，纳秒级开销
- session 结束后缓存保留 30s，供迟到的观察者回放
- 观察者 handler 抛异常不影响其他观察者

### 客户端自动观察

`SessionChatProvider` 检测到 `kind=background` 且 `bgStatus=running/pending` 时，自动调用 `startObserving(sessionId, scope)`：

1. 打开 SSE 连接到 `/agent/sessions/:id/observe`
2. 服务端回放所有已缓存的 chunks（中途加入也能看到之前的输出）
3. 实时接收新 chunks，通过 `processStreamChunk` 更新 streaming UI
4. session 完成或用户切走时自动关闭连接

## 客户端集成

### 数据源

客户端通过 `agentSessionStore.sessions` 获取所有会话，按 `kind` 字段过滤：

```typescript
// BackgroundTasksPanel.tsx
const bgSessions = allSessions
  .filter((s) => s.kind === 'background')
  .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))
```

没有独立的 task store，所有统计（活跃数、完成数、失败数）从 session 列表实时派生。

### UI 交互

- **AgentSessionList** — 统一展示 interactive 和 background session，BG session 带状态标签
- **BackgroundTasksPanel** — 后台任务监控面板，展示概览统计和任务列表
- **TaskToolCards** — 在聊天中渲染 `prizm_spawn_task` / `prizm_task_status` 工具调用的自定义卡片
- **点击运行中 BG session** — 自动开启 observe SSE，实时查看流式输出
- **点击已完成 BG session** — 查看完整对话记录

### WebSocket 事件

客户端通过 WS 接收 `bg:session.completed/failed/timeout/cancelled` 事件，触发 session 列表刷新和数据更新。

## 其他触发源

除了 `prizm_spawn_task` 工具，BG session 还可以从以下入口触发：

| 触发方式 | `triggerType` | 说明 |
|---------|---------------|------|
| LLM 工具 | `tool_spawn` | 父会话 LLM 调用 `prizm_spawn_task` |
| Cron 调度 | `cron` | `CronManager` 通过 `bgSessionManager.trigger()` 执行定时任务 |

所有触发方式最终都走 `bgSessionManager.trigger()` → `executeRun()` → `chatCore()` 的统一路径。

## 与旧架构的对比

| 维度 | 旧架构 | 新架构 |
|------|-------|-------|
| 数据层 | 独立的 BG 查询方法（list/getResult/getSummary） | 统一 scopeStore，按 kind 过滤 |
| API 路由 | 7+ 个 BG 专用路由（trigger/cancel/result/summary/batch-cancel） | 零 BG 专用路由 |
| 事件 | 7 种 BG 事件（triggered/started/chunk/completed/failed/timeout/cancelled） | 4 种（completed/failed/timeout/cancelled） |
| 流式输出 | WS 广播 bg:session.chunk | 无实时流（完成后查看记录） |
| 工具可见性 | `prizm_set_result` 仅 BG 可见 | 所有工具全局统一可见 |
| 客户端状态 | 独立 taskStore + BgPreviewContext | 从 agentSessionStore 派生 |
| 客户端 HTTP | 5+ 个 BG 专用 API 方法 | 零 BG 专用方法 |
| Manager 体积 | ~450 行（含 list/summary/broadcast/recover） | ~250 行（仅生命周期编排） |
