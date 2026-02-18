# 后台会话（Background Session）交互测试指南

> 通过 Electron 客户端直接与 Agent 对话，验证后台任务系统的端到端功能。

## 前提条件

- 服务端正在运行（`yarn dev:server`）
- 至少一个 LLM API key 已配置（`XIAOMIMIMO_API_KEY` / `ZHIPU_API_KEY` / `OPENAI_API_KEY`）
- Electron 客户端已连接到服务端

---

## 场景 1：异步派发子任务 + 查询状态

### 对话流程

**第一步 — 派发任务：**

> 你："帮我创建一个后台任务，总结一下我当前 scope 里的所有文档"

Agent 预期行为：调用 `prizm_spawn_task`

```json
{
  "task": "总结当前 scope 的所有文档",
  "mode": "async",
  "label": "文档总结"
}
```

预期返回：任务 ID + "异步执行中"提示。

**第二步 — 查询状态：**

> 你："刚才那个任务完成了吗？"

Agent 预期行为：调用 `prizm_task_status`

```json
{ "action": "list" }
```

或指定任务 ID：

```json
{ "action": "status", "task_id": "<上一步返回的 ID>" }
```

### 验证点

- [ ] `prizm_spawn_task` 被调用，返回有效的 session ID
- [ ] 后台会话被创建（`kind='background'`，`bgStatus` 从 `pending` → `running` → `completed`）
- [ ] `prizm_task_status` 能列出/查询到该任务
- [ ] 后台会话独立运行，不影响当前交互对话

---

## 场景 2：同步派发（阻塞等结果）

### 对话流程

> 你："帮我同步执行一个快速任务：把'你好世界'翻译成英文，等结果回来"

Agent 预期行为：调用 `prizm_spawn_task`

```json
{
  "task": "把'你好世界'翻译成英文",
  "mode": "sync",
  "timeout_seconds": 30
}
```

### 验证点

- [ ] 调用阻塞，直到后台会话完成后才返回
- [ ] 返回内容包含：状态、会话 ID、耗时、实际结果
- [ ] 后台会话的 `bgResult` 字段有值（通过 `prizm_set_result` 或 result guard fallback）

---

## 场景 3：取消正在运行的任务

### 对话流程

**第一步 — 派发一个较长的任务：**

> 你："在后台帮我写一篇 1000 字的文章，主题随意"

**第二步 — 立即取消：**

> 你："取消刚才那个任务"

Agent 预期行为：调用 `prizm_task_status`

```json
{ "action": "cancel", "task_id": "<任务 ID>" }
```

### 验证点

- [ ] 取消成功，返回确认信息
- [ ] 后台会话状态变为 `cancelled`
- [ ] `bg:session.cancelled` 事件被触发（可在服务端日志中看到）

---

## 场景 4：获取已完成任务的完整结果

### 对话流程

> 你："看看刚才那个任务的完整结果"

Agent 预期行为：调用 `prizm_task_status`

```json
{ "action": "result", "task_id": "<任务 ID>" }
```

### 验证点

- [ ] 已完成任务返回完整输出内容
- [ ] 未完成任务返回"结果不可用"提示
- [ ] 不存在的任务 ID 返回错误提示

---

## 场景 5：验证 `prizm_set_result` 对交互会话不可见

### 对话流程

> 你："请调用 prizm_set_result 工具"

### 验证点

- [ ] Agent 在工具列表中找不到 `prizm_set_result`（该工具仅注入 `kind='background'` 的会话）
- [ ] 如果 Agent 硬拼工具名调用，executor 返回"此工具仅在后台会话中生效，当前为交互会话"

---

## 场景 6：带上下文和输出格式的任务

### 对话流程

> 你："在后台帮我做个任务：根据以下信息生成一份会议纪要。参会人：张三、李四。主题：Q1 目标回顾。要求输出 Markdown 格式。"

Agent 预期行为：调用 `prizm_spawn_task`

```json
{
  "task": "根据参会信息生成会议纪要",
  "mode": "async",
  "label": "会议纪要生成",
  "context": "{\"attendees\":[\"张三\",\"李四\"],\"topic\":\"Q1 目标回顾\"}",
  "expected_output": "Markdown 格式的会议纪要"
}
```

### 验证点

- [ ] 上下文数据被正确传入后台会话的 system prompt
- [ ] 输出格式要求被注入 system prompt
- [ ] 后台 LLM 最终调用 `prizm_set_result` 提交结果

---

## 快速验证脚本（一次对话跑完）

按顺序发送以下消息，可在一次对话中验证核心链路：

| 步骤 | 你说的话 | 预期 Agent 行为 |
|------|----------|----------------|
| 1 | "帮我创建一个后台任务：列出当前 scope 的所有待办清单，标签叫'todo汇总'" | 调用 `prizm_spawn_task`，返回任务 ID |
| 2 | "查一下我有哪些后台任务" | 调用 `prizm_task_status({ action: "list" })`，显示任务列表 |
| 3 | "那个任务完成了吗？把结果给我看看" | 调用 `prizm_task_status({ action: "status/result" })`，显示结果 |
| 4 | "再派一个同步任务：用一句话总结'Prizm是什么'" | 调用 `prizm_spawn_task({ mode: "sync" })`，阻塞后直接返回结果 |

---

## 已知风险与注意事项

| 风险点 | 说明 | 应对 |
|--------|------|------|
| LLM 不主动调用 `prizm_set_result` | 后台会话 system prompt 里有明确指示，但模型可能忽略 | Result Guard 机制会追加一轮提醒；最终 fallback 从 assistant 消息中提取 |
| LLM API 未配置 | 后台会话需要独立调用 LLM | 确保至少一个 provider 的 API key 已设置 |
| sync 模式超时 | 同步模式如果 LLM 响应慢或任务复杂，可能超时 | 适当增大 `timeout_seconds`，或改用 async 模式 |
| 并发限制 | 默认全局最多 10 个 BG session，单父会话最多 5 个 | 达到上限时 `prizm_spawn_task` 返回错误 |
| 嵌套深度限制 | 默认最大嵌套 2 层（BG session 内再 spawn） | 超过深度时返回错误 |

---

## 代码接线确认

以下是确保端到端链路通的关键接线点：

| 模块 | 文件 | 状态 |
|------|------|------|
| 工具定义 | `builtinTools/definitions.ts` → `getBuiltinTools()` 包含 `prizm_spawn_task` + `prizm_task_status` | ✅ |
| 后台专属工具 | `getBackgroundOnlyTools()` 包含 `prizm_set_result` | ✅ |
| 条件注入 | `DefaultAgentAdapter.chat()` 中 `if (session?.kind === 'background')` | ✅ |
| 工具执行 | `executor.ts` switch-case 包含三个 taskTools 分发 | ✅ |
| Manager 初始化 | `server.ts` → `bgSessionManager.init(adapters.agent)` | ✅ |
| 事件处理器 | `server.ts` → `registerBgSessionHandlers()` | ✅ |
| API 路由 | `routes/agent/sessions.ts` → trigger / cancel / result / summary | ✅ |
| Session 持久化 | `sessionStore.ts` 支持 BG 字段解析与写入 | ✅ |
