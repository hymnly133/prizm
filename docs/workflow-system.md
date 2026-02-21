# Prizm Workflow 系统

## 一、总体定位

Workflow 系统是 Prizm 的**多步骤自动化流水线引擎**，允许用户将多个 AI Agent 任务、人工审批、数据变换步骤编排为可复用的工作流。它深度集成了 Background Session（后台会话）、EventBus（事件总线）、文件工作区等核心能力，形成一条从 **定义 → 触发 → 执行 → 审批 → 联动** 的完整链路。

### 能力与限制

| 维度 | 当前能力 | 限制说明 |
|------|----------|----------|
| 执行拓扑 | 线性管线 | 按 `steps` 顺序执行；支持 `condition` 跳过步骤；**不支持** DAG、并行分支、多步并行。 |
| 触发方式 | 手动 + 事件 | 支持 `schedule_remind`、`todo_completed`、`document_saved` 事件触发；**cron** 在定义 schema 中合法，但**未接入调度器**，不会按 cron 表达式自动触发工作流。 |
| 审批与恢复 | 已支持 | `approve` 步骤暂停、`resumeToken`、`resumeWorkflow(token, approved)`。 |
| 超时 | 已支持 | 步骤级 `timeoutMs`、工作流级 `maxTotalTimeoutMs`。 |
| 输出 | 已支持上限 | 可选 `config.maxStepOutputChars` 限制单步文本 output，超出截断并追加 `... (truncated)`。 |
| 工作区与安全 | 工作区边界 | Agent 步骤限定在工作流工作区内；详见下文「工作区边界与安全」。 |

与 OpenClaw Lobster 等方案的对比可参考《工作流引擎全面审计》结论。

**可视化编辑器**：Electron 客户端工作流页提供画布编辑（`WorkflowEditor`）。图中连线仅表示**执行顺序与数据依赖**，不表示分支或并行；当前引擎为串行执行，若未来支持分支需在定义与 runner 中扩展（如 `nextStepId` / 条件分支节点）。

## 二、核心架构

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Client (React + Zustand)                          │
│  WorkflowStore / WorkflowPipelineView / WorkflowRunDetail   │
├────────────────────────┬────────────────────────────────────┤
│  Client SDK            │  LLM 内置工具                       │
│  PrizmClient.workflow   │  workflowTools.ts                  │
├────────────────────────┴────────────────────────────────────┤
│  REST API Layer (routes/workflow.ts)                         │
├─────────────────────────────────────────────────────────────┤
│  Workflow Engine (core/workflowEngine/)                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Parser  │ │ Runner   │ │ ResumeStore  │ │ RunMetaWriter│ │
│  └─────────┘ └────┬─────┘ └──────────────┘ └─────────────┘ │
│                    │                                         │
│        ┌───────────┴───────────┐                            │
│        │ IStepExecutor 抽象层  │                            │
│        └───────────┬───────────┘                            │
│                    ▼                                         │
│        BgSessionStepExecutor → BackgroundSessionManager      │
├─────────────────────────────────────────────────────────────┤
│  支撑层：PathProviderCore / WorkspaceResolver / EventBus     │
│         LinkedActionExecutor / TriggerHandlers               │
└─────────────────────────────────────────────────────────────┘
```

## 三、领域模型

所有类型定义位于 `@prizm/shared`（`prizm-shared/src/domain.ts`）。

### 3.1 WorkflowDef — 工作流定义

```typescript
interface WorkflowDef {
  name: string
  description?: string
  steps: WorkflowStepDef[]
  /** 流水线输入 schema，与 run.args 配合；每参数可带 description、default、type。有 default 即可选，不填时用默认值。合并规则：空串视为未传，使用 default。 */
  args?: Record<string, { default?: unknown; description?: string; type?: string }>
  /** 流水线输出 schema，与 args 形态对称（description + type），传入最后一步做结构化对齐输出 */
  outputs?: Record<string, { type?: string; description?: string }>
  triggers?: WorkflowTriggerDef[]
}
```

### 3.2 WorkflowStepDef — 步骤定义

```typescript
type WorkflowStepType = 'agent' | 'approve' | 'transform'

interface WorkflowStepDef {
  id: string
  type: WorkflowStepType
  prompt?: string             // agent step 的 prompt
  approvePrompt?: string      // approve step 的审批提示
  transform?: string          // transform step 的 dot-path 表达式
  input?: string              // 输入引用：'$prev.output' 或 '$stepId.output'
  condition?: string           // 条件表达式：'$stepId.approved' 等
  model?: string
  timeoutMs?: number
  linkedActions?: WorkflowLinkedAction[]
}
```

三种步骤类型：

| 类型 | 用途 | 关键字段 |
|------|------|----------|
| `agent` | 由 LLM + BG Session 自主执行任务 | `prompt`, `input`, `model`, `timeoutMs` |
| `approve` | 暂停流程等待人工审批 | `approvePrompt` |
| `transform` | 本地 JSON 数据变换（不调用 LLM） | `transform`（dot-path 表达式） |

### 3.3 WorkflowStepResult — 步骤执行结果

```typescript
type WorkflowStepResultStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

interface WorkflowStepResult {
  stepId: string
  status: WorkflowStepResultStatus
  output?: string
  structuredData?: string    // JSON 字符串，由 prizm_set_result 的 structured_data 写入
  artifacts?: string[]       // 产出文件列表（相对于 workflow 工作区）
  sessionId?: string         // agent step 关联的 BG Session ID
  approved?: boolean         // approve step 的审批结果
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  error?: string
}
```

### 3.4 WorkflowRun — 运行实例

```typescript
type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

interface WorkflowRun {
  id: string
  workflowName: string
  scope: string
  status: WorkflowRunStatus
  currentStepIndex: number
  stepResults: Record<string, WorkflowStepResult>
  resumeToken?: string
  args?: Record<string, unknown>
  triggerType?: 'manual' | 'cron' | 'schedule' | 'event'
  linkedScheduleId?: string
  linkedTodoId?: string
  createdAt: number
  updatedAt: number
  error?: string
}
```

### 3.5 流水线 I/O 与数据源约定（单一数据源、无冲突分支）

- **流水线输入**：仅定义一个输入，数据源为 `run.args`（运行时值）与 `def.args`（schema）。首步**仅通过 inputParams** 消费流水线输入；不鼓励在首步用 `step.input: $args.xxx` 拼文案。每次执行 agent 步骤时，系统会在该步骤的系统指令中注入本次流水线的原始输入（run.args）。
- **流水线输出**：仅采用**最后一步**定义的输出作为流水线输出。以 schema 驱动：若 `def.outputs` 留空，使用必选单字段 **output** 作为默认；若 `def.outputs` 非空，末步必须按该格式提交并接受 schema 校验。唯一真相源为 `stepResults[lastStepId]`（`output` + `structuredData`）；`finalOutput` / `finalStructuredOutput` 仅派生不持久化。
- **步骤状态与概览**：唯一数据源为 `WorkflowStepResult`（及 def/run.args）。步骤概览（如「有输入 · 有输出 · N 个产物」）**仅派生**自 stepResults，不新增持久化的 overview/summary 字段。

### 3.6 辅助类型

```typescript
// 步骤联动操作
interface WorkflowLinkedAction {
  type: 'create_todo' | 'update_todo' | 'create_document' | 'update_schedule' | 'notify'
  params: Record<string, string>   // 支持 $stepId.output 变量引用
}

// 声明式触发条件
interface WorkflowTriggerDef {
  type: 'cron' | 'schedule_remind' | 'todo_completed' | 'document_saved'
  filter?: Record<string, string>  // 事件过滤条件
}

// 已注册的工作流定义（持久化形态）
interface WorkflowDefRecord {
  id: string
  name: string
  scope: string
  yamlContent: string
  description?: string
  triggersJson?: string
  createdAt: number
  updatedAt: number
}
```

## 四、核心模块详解

所有引擎模块位于 `prizm/src/core/workflowEngine/`。

### 4.1 Parser（`parser.ts`）

**职责**：将 YAML 或 JSON 字符串解析为 `WorkflowDef`，并进行结构校验。

- 支持 **YAML / JSON** 双格式（以 `{` 开头视为 JSON，否则视为 YAML）
- 校验规则：
  - `name` 必填
  - `steps` 非空数组
  - `stepId` 不可重复
  - `type` 必须为 `agent` / `approve` / `transform`
  - `agent` 步骤必须有 `prompt`
  - `approve` 步骤必须有 `approvePrompt` 或 `prompt`
  - `transform` 步骤必须有 `transform`
  - `$stepId` 引用必须指向已声明的前序步骤（`$prev` 除外）
- 支持 `triggers` 触发条件校验
- `serializeWorkflowDef()` 可将 `WorkflowDef` 导出为 YAML 字符串

### 4.2 WorkflowRunner（`runner.ts`）

**职责**：核心执行引擎，驱动工作流从头到尾运行。

#### 主要方法

| 方法 | 功能 |
|------|------|
| `runWorkflow(scope, def, options?)` | 启动一次完整工作流运行 |
| `resumeWorkflow(resumeToken, approved)` | 恢复因 approve 暂停的工作流 |
| `cancelWorkflow(runId)` | 取消运行中或暂停的工作流 |

#### 执行流程

```
runWorkflow()
│
├─ 1. ensureWorkflowWorkspace()     // 创建持久工作区
├─ 2. cleanWorkspaceFreeArea()      // (可选) 清理自由区域
├─ 3. store.createRun()             // 创建 SQLite 运行记录
├─ 4. emit('workflow:started')
│
└─ executeFromStep(startIndex=0)
    │
    ├─ for each step in def.steps:
    │   ├─ 检查 cancelled 状态
    │   ├─ evaluateCondition() → skip 或执行
    │   │
    │   ├─ executeStep():
    │   │   ├─ agent  → executeAgentStep() → IStepExecutor.execute()
    │   │   ├─ approve → return { status: 'paused' }
    │   │   └─ transform → 本地 JSON 变换
    │   │
    │   ├─ extractBgSessionData()   // 提取 structuredData + artifacts
    │   ├─ store.updateRunStep()    // 更新 SQLite
    │   ├─ flushRunMeta()           // 写入 .meta/runs/{runId}.md
    │   ├─ emit('workflow:step.completed')
    │   │
    │   └─ executeLinkedActions()   // 执行联动操作
    │
    └─ 完成后 → emit('workflow:completed')
```

#### 变量引用系统（`resolveReference`）

在步骤的 `input` 字段中支持以下引用语法：

| 语法 | 含义 |
|------|------|
| `$stepId.output` | 指定步骤的文本输出 |
| `$stepId.data.xxx` | 从步骤的 `structuredData` JSON 中深层提取字段 |
| `$stepId.data.a.b` | 支持多级嵌套 |
| `$prev.output` | 最近一个 completed 步骤的输出 |
| `$args.key` | 工作流启动参数 |

#### 条件执行（`evaluateCondition`）

`condition` 字段支持：

- `$stepId.approved` — 审批结果，值为 `true` / `false`
- `$stepId.output` — 是否有输出（truthy check）

条件为 false 时步骤标记为 `skipped`，流程继续执行后续步骤。

### 4.3 IStepExecutor / BgSessionStepExecutor

**IStepExecutor** 是步骤执行的抽象接口，将执行后端与 Runner 解耦：

```typescript
interface IStepExecutor {
  execute(scope: string, input: StepExecutionInput): Promise<StepExecutionOutput>
}

interface StepExecutionInput {
  prompt: string
  context?: Record<string, unknown>
  systemInstructions?: string
  expectedOutputFormat?: string
  model?: string
  timeoutMs?: number
  label?: string
  workspaceDir?: string   // Workflow 工作区绝对路径
}

interface StepExecutionOutput {
  sessionId: string
  status: 'success' | 'partial' | 'failed' | 'timeout' | 'cancelled'
  output: string
  structuredData?: string
  durationMs: number
}
```

**BgSessionStepExecutor** 是默认实现，将 `BackgroundSessionManager.triggerSync()` 包装为 `IStepExecutor` 接口。关键特性：

- 传入 `workspaceDir` → BG Session 将该 workflow 工作区作为默认文件操作根目录
- `triggerType: 'event_hook'`，`autoCleanup: true`
- 未来可替换为 MCP、HTTP 等执行后端

### 4.4 ResumeStore（`resumeStore.ts`）

**职责**：SQLite 持久化存储工作流运行状态和已注册定义。

文件位置：`.prizm-data/workflow_runs.db`

| 表 | 字段 | 用途 |
|----|------|------|
| `workflow_runs` | id, workflow_name, scope, status, current_step_index, step_results_json, args_json, resume_token, trigger_type, ... | 运行实例持久化 |
| `workflow_defs` | id, name, scope, yaml_content, description, triggers_json, ... | 已注册工作流定义 |

主要操作：

- **Run CRUD**：`createRun`、`getRunById`、`listRuns`、`updateRunStatus`、`updateRunStep`、`getRunByResumeToken`、`deleteRun`
- **Def CRUD**：`registerDef`（upsert）、`getDefByName`、`listDefs`、`deleteDef`
- **维护**：`pruneRuns(retentionDays=90)` — 自动清理 90 天前已结束的运行记录

使用 WAL 模式和 `busy_timeout = 5000` 确保并发安全。

### 4.5 RunMetaWriter（`runMetaWriter.ts`）

**职责**：将运行元数据写为 `.meta/runs/{runId}.md` 文件，格式为 YAML frontmatter + Markdown body。

```markdown
---
runId: run-abc123
workflowName: daily-report
status: completed
triggerType: manual
startedAt: 1700000000000
finishedAt: 1700000050000
steps:
  collect:
    status: completed
    sessionId: sess-xyz
    durationMs: 30000
    data:
      sentiment: positive
      score: 0.92
    artifacts:
      - reports/raw-data.csv
  generate:
    status: completed
    sessionId: sess-abc
    durationMs: 15000
---

# Run: daily-report

## Step: collect
收集到了以下数据...

## Step: generate
根据数据生成了分析报告...
```

优势：

- Agent 可在工作区内直接读取历史运行记录
- 人类可读的运行日志
- 跨 run 上下文传递（后续 run 可以看到历史数据）

主要函数：

- `writeRunMeta(scopeRoot, data)` — 写入/更新
- `readRunMeta(scopeRoot, workflowName, runId)` — 读取
- `listRecentRuns(scopeRoot, workflowName, limit=5)` — 按修改时间倒序列出

### 4.6 运行错误与日志

工作流运行失败时，错误信息会**完整持久化**并在客户端提供查看入口。

**存储位置**

- **SQLite**（`workflow_runs` 表）  
  - Run 级：`error`（简短消息）、`error_detail`（堆栈或完整详情，可选）  
  - 步骤级：`step_results_json` 内每个步骤的 `error`、`errorDetail`（可选）
- **Run Meta 文件**（`.meta/runs/{runId}.md`）  
  - frontmatter 中 run 级 `errorDetail`、每个 step 的 `error` / `errorDetail`  
  - Markdown body 中步骤失败时写 `Error: ...` 及可选的堆栈代码块

**字段含义**

- `error`：面向用户的简短错误消息（如 `require is not defined`）。
- `errorDetail`：堆栈或完整错误详情，便于开发/运维排查；仅在“能拿到 Error 对象”时写入（例如步骤在 Runner 内抛错）。

**何时有 errorDetail**

- **步骤在 Runner 内抛错**（如执行超时、transform 异常、网络/模块加载异常）：会写入该步骤的 `error` + `errorDetail`，以及 run 级的 `error` + `error_detail`。
- **步骤由 Executor 返回失败**（如 BG Session 返回 `status: 'failed'`）：当前仅写入 `error` 消息，堆栈可查服务端日志；后续可在 `StepExecutionOutput` 中扩展 `errorDetail`。

**用户查看方式**

- 在 Electron 客户端的**工作流运行详情**弹窗中（工作流 → 运行列表 → 点击某次运行）：
  - Run 级：若存在 `run.error`，会展示错误消息；若存在 `run.errorDetail`，可展开「查看堆栈/详情」并复制。
  - 步骤级：时间线中每个失败步骤展示 `step.error`；若存在 `step.errorDetail`，可展开「查看堆栈/详情」并复制。

**服务端日志**

- Runner 在步骤失败时会打日志：`log.error('Workflow step "..." failed:', err)`，便于在服务端日志中查看完整 Error（含堆栈）。

### 4.7 LinkedActionExecutor（`linkedActionExecutor.ts`）

**职责**：在步骤完成后执行声明式联动操作，将工作流与 Prizm 的 Todo/文档/日程/通知系统打通。

支持的操作类型：

| type | 功能 | 关键参数 |
|------|------|----------|
| `create_todo` | 创建待办事项 | `name`, `title`, `description` |
| `update_todo` | 更新待办状态 | `listId`, `itemId`, `status` |
| `create_document` | 创建文档 | `title`, `content`, `tags` |
| `update_schedule` | 更新日程状态 | `scheduleId`, `status` |
| `notify` | 发送通知 | `title`, `body` |

所有参数支持 `$stepId.output`、`$args.key` 变量引用。操作完成后通过 EventBus emit 对应事件（如 `todo:mutated`、`document:saved`）。

### 4.8 TriggerHandlers（`triggerHandlers.ts`）

**职责**：订阅 EventBus 事件，当事件匹配已注册工作流的 trigger 条件时自动启动运行。

| 订阅事件 | trigger type | 触发条件 |
|----------|-------------|----------|
| `schedule:reminded` | `schedule_remind` | 日程提醒到期 |
| `todo:mutated` (status=done) | `todo_completed` | 待办完成 |
| `document:saved` | `document_saved` | 文档保存 |

支持 `filter` 字段精细匹配，例如 `{ scheduleId: "sched-123" }` 仅在特定日程触发。

匹配逻辑：遍历当前 scope 下所有已注册定义的 `triggersJson`，逐个比对 type 和 filter。

## 五、存储层级

```
{scopeRoot}/                            # Scope 主工作区
└── .prizm/
    └── workflows/
        └── {workflowName}/             # Workflow 持久工作区（跨 run 复用）
            ├── .meta/
            │   ├── runs/
            │   │   ├── {runId-1}.md    # 运行元数据
            │   │   └── {runId-2}.md
            │   ├── def.json            # 定义元数据（id, createdAt, updatedAt 等）
            │   └── versions/           # 流水线版本快照（无记忆功能，仅快照与回溯）
            │       └── {timestamp}.yaml
            ├── workflow.yaml           # 当前定义内容
            ├── reports/                 # Agent 产出文件（自由区域）
            ├── data/
            └── ...

.prizm-data/
├── workflow_runs.db                    # 运行实例 + 定义注册（SQLite）
└── ...
```

**三级存储隔离**：`scope` > `workflow` > `session`

设计原则：

- **文件友好**：所有数据通过文件系统组织，Agent 可直接操作
- **持久复用**：Workflow 工作区在多次 run 间保留，后续 run 可看到历史数据
- **按需清理**：`cleanBefore: true` 仅清空自由区域，保留 `.meta/` 历史记录

#### 工作区边界与安全

- Agent 步骤通过 Runner 传入的 `workspaceDir` / `runWorkspaceDir` 限定**默认文件操作根目录**，由 PathProviderCore 与工作流工作区解析得到（`ensureWorkflowWorkspace`、`ensureRunWorkspace`）。
- 步骤内使用的 `prizm_file` 等工具在工作流上下文中应限制在该工作流工作区内，实现上通过 BG Session 的 `workspaceDir` 体现。
- 当前无工作区外路径的显式白名单/黑名单校验；若需更严格沙箱（如禁止访问工作区外路径），可在后续版本扩展。

## 六、API 层

### 6.1 REST 路由

路由模块：`prizm/src/routes/workflow.ts`

| 方法 | 路径 | 功能 | 备注 |
|------|------|------|------|
| GET | `/workflow/defs` | 列出已注册定义 | 需要 scope |
| POST | `/workflow/defs` | 注册/更新工作流定义 | body: `{ name, yaml, description? }` |
| GET | `/workflow/defs/:id` | 获取单条定义 | |
| GET | `/workflow/defs/:id/versions` | 列出流水线版本列表（无记忆功能） | 按时间倒序 |
| GET | `/workflow/defs/:id/versions/:versionId` | 获取指定版本 YAML 内容 | |
| POST | `/workflow/defs/:id/rollback` | 一键回溯到指定版本 | body: `{ versionId }`，当前内容会先被保存为快照 |
| DELETE | `/workflow/defs/:id` | 删除定义 | |
| POST | `/workflow/run` | 启动运行 | body: `{ workflow_name?, yaml?, args? }` |
| POST | `/workflow/resume` | 恢复暂停的工作流 | body: `{ resume_token, approved? }` |
| GET | `/workflow/runs` | 列出运行记录 | 支持 `?status=` 过滤 |
| GET | `/workflow/runs/:id` | 获取运行详情 | |
| DELETE | `/workflow/runs/:id` | 取消/删除运行 | 运行中→取消，已结束→删除 |

### 6.2 Agent 内置工具

工具模块：`prizm/src/llm/builtinTools/workflowTools.ts`

Agent 可通过 `prizm_workflow` 工具操控工作流，通过 `action` 参数分发：

| action | 功能 | 参数 |
|--------|------|------|
| `run` | 启动工作流 | `yaml` 或 `workflow_name`, `args?` |
| `resume` | 恢复暂停工作流 | `resume_token`, `approved?` |
| `list` | 列出运行记录 | — |
| `status` | 查询运行详情 | `run_id` |
| `cancel` | 取消运行 | `run_id` |
| `register` | 注册工作流定义 | `workflow_name`, `yaml`, `description?` |
| `list_defs` | 列出已注册定义 | — |

### 6.3 Client SDK

模块：`prizm-client-core/src/http/mixins/workflow.ts`

为 `PrizmClient` 扩展的方法：

```typescript
interface PrizmClient {
  getWorkflowDefs(scope?: string): Promise<WorkflowDefRecord[]>
  registerWorkflowDef(name, yaml, description?, scope?): Promise<WorkflowDefRecord>
  deleteWorkflowDef(defId: string): Promise<void>
  runWorkflow(payload, scope?): Promise<WorkflowRunResult>
  resumeWorkflow(resumeToken, approved?): Promise<WorkflowRunResult>
  getWorkflowRuns(scope?, status?): Promise<WorkflowRun[]>
  getWorkflowRun(runId: string): Promise<WorkflowRun | null>
  cancelWorkflowRun(runId: string): Promise<void>
}
```

## 七、事件体系

5 种工作流事件通过 EventBus emit，经 `wsBridgeHandlers` 推送到 WebSocket 客户端：

| 事件 | 触发时机 | Payload |
|------|----------|---------|
| `workflow:started` | 工作流开始运行 | `{ scope, runId, workflowName }` |
| `workflow:step.completed` | 步骤完成/跳过/失败 | `{ scope, runId, stepId, stepStatus, outputPreview? }` |
| `workflow:paused` | 遇到 approve 步骤暂停 | `{ scope, runId, workflowName, stepId, approvePrompt }` |
| `workflow:completed` | 全部步骤完成 | `{ scope, runId, workflowName, finalOutput? }` |
| `workflow:failed` | 运行失败/取消 | `{ scope, runId, workflowName, error }` |

这些事件同时用于：

- WebSocket 实时推送给前端
- 客户端 `WorkflowStore` 的实时状态更新
- 触发其他工作流（如果存在匹配的 trigger）

## 八、客户端 UI

### 8.1 WorkflowStore（Zustand）

模块：`prizm-electron-client/src/store/workflowStore.ts`

状态管理，维护 `runs[]` 和 `defs[]` 列表。特性：

- 通过 WebSocket 事件实时更新（debounce 500ms）
- `patchStepResult()` — 本地即时 patch 单步状态，无需等待服务端刷新
- `bind(http, scope)` — 切换 scope 时自动刷新

### 8.2 WorkflowPipelineView

模块：`prizm-electron-client/src/components/workflow/WorkflowPipelineView.tsx`

流水线可视化组件：

- 水平布局展示步骤节点和连接线（超过 8 步自动切换垂直布局）
- 每个节点根据状态显示不同图标和颜色（completed=绿、running=蓝、failed=红、paused=黄）
- 步骤类型图标：agent=机器人、approve=审批、transform=转换
- 点击节点弹出 Popover 展示详情：output 预览、耗时、错误信息、session ID
- approve 步骤暂停时显示「批准 / 拒绝」按钮

### 8.3 MiniPipelineView

同模块导出的迷你版组件，仅显示圆点和连线，用于 tool card 等空间有限的场景内嵌。

## 九、工作流定义示例

### YAML 格式

```yaml
name: daily-report
description: 每日数据收集与报告生成
args:
  topic:
    default: AI
    description: 报告主题
triggers:
  - type: schedule_remind
    filter:
      title: "每日报告"
steps:
  - id: collect
    type: agent
    prompt: "收集关于 $args.topic 的最新数据，并以 JSON 格式输出结构化结果"

  - id: review
    type: approve
    approvePrompt: "数据收集完成，确认生成报告？"

  - id: generate
    type: agent
    prompt: "基于收集的数据生成分析报告"
    input: "$collect.output"
    condition: "$review.approved"
    linkedActions:
      - type: create_document
        params:
          title: "日报: $args.topic"
          content: "$generate.output"
      - type: notify
        params:
          title: "日报已生成"
          body: "$args.topic 日报已自动创建"

  - id: extract
    type: transform
    input: "$collect.output"
    transform: "data.summary"
```

### JSON 格式

```json
{
  "name": "simple-analysis",
  "steps": [
    { "id": "analyze", "type": "agent", "prompt": "分析给定的数据" },
    { "id": "summary", "type": "agent", "prompt": "总结分析结果", "input": "$analyze.output" }
  ]
}
```

## 十、文件清单

```
prizm/src/core/workflowEngine/
├── index.ts                    # barrel exports
├── types.ts                    # IStepExecutor, StepExecutionInput/Output, WorkflowRunResult, RunWorkflowOptions
├── parser.ts                   # YAML/JSON 解析 + 校验
├── runner.ts                   # WorkflowRunner 核心执行引擎
├── resumeStore.ts              # SQLite 持久化（运行状态 + 定义注册）
├── runMetaWriter.ts            # .meta/runs/{runId}.md 文件读写
├── bgSessionStepExecutor.ts    # IStepExecutor 的 BG Session 实现
├── linkedActionExecutor.ts     # 步骤联动操作执行器
├── triggerHandlers.ts          # EventBus 事件触发处理器
├── parser.test.ts
├── runner.test.ts
├── resumeStore.test.ts
├── runMetaWriter.test.ts
├── bgSessionStepExecutor.test.ts
├── linkedActionExecutor.test.ts
└── integration.test.ts

prizm/src/routes/workflow.ts                            # REST API 路由
prizm/src/llm/builtinTools/workflowTools.ts             # Agent 内置工具
prizm-shared/src/domain.ts                              # 领域类型（WorkflowDef, WorkflowRun 等）
prizm-shared/src/events.ts                              # 事件类型定义
prizm-client-core/src/http/mixins/workflow.ts           # Client SDK mixin
prizm-electron-client/src/store/workflowStore.ts        # Zustand 状态管理
prizm-electron-client/src/components/workflow/
├── WorkflowPipelineView.tsx                            # 流水线可视化
├── WorkflowRunDetail.tsx                               # 运行详情面板
└── WorkflowToolCards.tsx                               # 工具卡片
```

## 相关文档

- **[工作流管理会话「重建对话」完整流程](workflow-management-session-rebuild.md)**：从 UI 触发、客户端删除/创建会话、服务端引用校验与 def 更新，到标签页与主区状态同步的端到端说明。
