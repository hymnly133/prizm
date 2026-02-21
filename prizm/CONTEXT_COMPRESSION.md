# Agent 上下文动态压缩系统

基于 A/B 轮数滑动窗口的 Session 记忆压缩机制，在保持对话连续性的同时控制上下文 token 规模。**大多数用户使用默认 A/B 即可，仅需调优长对话或 token 预算时再改环境变量或 agent-tools.json。**

## 核心参数

| 参数 | 含义 | 默认值 |
|------|------|--------|
| **A** (fullContextTurns) | 完全上下文轮数，压缩后至少保留 A 轮 raw | 4 |
| **B** (cachedContextTurns) | 缓存轮数，每 B 轮压缩为一段 | 3 |

一轮 = 1 个 user 消息 + 1 个 assistant 消息。

## 工作流程

### 1. 未达压缩阈值 (K < A+B)

- 发送**全部原始对话**到 LLM
- 不进行 Session 记忆抽取

### 2. 压缩触发条件

当**未压缩区（cache）** 达到 A+B 轮时触发压缩：

- 未压缩区大小 = `K - compressedThrough`
- 条件：`uncompressedRounds >= A + B`
- 每次压缩**恰好 B 轮**（最老的一段）

### 3. 发送顺序

K >= A+B 时，发送给 LLM 的结构为：

```
[User Memory]           (检索注入)
[Scope Memory]          (检索注入)
[Session Memory]        (压缩块列表，来自检索)
[所有未压缩 raw]        (cache：即将被压缩的原始对话)
[current user 消息]
```

- **压缩块**：已压缩的轮次以 Session Memory 形式注入，按时间顺序（最老在前）
- **Raw（cache）**：所有未压缩轮次，代表即将被压缩的原始对话

### 4. 压缩节奏示例

假设 A=4, B=3：

| K (总轮数) | 动作 | compressedThrough | 未压缩区 | 发送内容 |
|------------|------|-------------------|----------|----------|
| 1..6       | 不压缩 | 0 | 1..6 | 全量 raw |
| 7          | 压缩 1..3 | 3 | 4..7 | Session(1..3) + raw(4..7) |
| 8          | 不压缩 | 3 | 4..8 | Session(1..3) + raw(4..8) |
| 9          | 不压缩 | 3 | 4..9 | Session(1..3) + raw(4..9) |
| 10         | 压缩 4..6 | 6 | 7..10 | Session(1..6) + raw(7..10) |

## 记忆分层

| 层级 | 抽取时机 | 用途 |
|------|----------|------|
| **User** | 每轮不抽 Session，仅抽 Profile | 用户画像、偏好 |
| **Scope** | 每轮 | 历史摘要、计划、文档知识 |
| **Session** | 批量压缩时 (sessionOnly) | 已压缩轮次的 EventLog |

每轮对话后仅抽取 User + Scope；Session 仅在压缩时批量抽取。

## 配置

### 服务端

- 环境变量：`PRIZM_FULL_CONTEXT_TURNS`、`PRIZM_CACHED_CONTEXT_TURNS`（覆盖默认值）
- 设置存储：`agent-tools.json` -> `agent.contextWindow`
- 请求体：`fullContextTurns`、`cachedContextTurns` 可覆盖单次请求

### 客户端

在 Agent 设置 > 上下文窗口中配置 A、B，保存后写入服务端 `agent-tools.json`。

## 关键实现

- `prizm/src/routes/agent.ts`：压缩判断、历史构建、注入顺序
- `prizm/src/llm/EverMemService.ts`：`addSessionMemoryFromRounds`（批量 Session 抽取）
- `packages/evermemos`：`MemoryRoutingContext.sessionOnly`（仅抽 EventLog 到 Session）
- `prizm-shared`：`AgentSession.compressedThroughRound`（持久化压缩进度）
