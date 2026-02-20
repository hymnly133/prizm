# Prizm Workflow 系统

## 一、总体定位

Workflow 系统是 Prizm 的**多步骤自动化流水线引擎**，允许用户将多个 AI Agent 任务、人工审批、数据变换步骤编排为可复用的工作流。它深度集成了 Background Session（后台会话）、EventBus（事件总线）、文件工作区等核心能力，形成一条从 **定义 → 触发 → 执行 → 审批 → 联动** 的完整链路。

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
  args?: Record<string, { default?: unknown; description?: string }>
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

### 3.5 辅助类型

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

### 4.6 LinkedActionExecutor（`linkedActionExecutor.ts`）

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

### 4.7 TriggerHandlers（`triggerHandlers.ts`）

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
            │   └── runs/
            │       ├── {runId-1}.md    # 运行元数据
            │       └── {runId-2}.md
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

## 六、API 层

### 6.1 REST 路由

路由模块：`prizm/src/routes/workflow.ts`

| 方法 | 路径 | 功能 | 备注 |
|------|------|------|------|
| GET | `/workflow/defs` | 列出已注册定义 | 需要 scope |
| POST | `/workflow/defs` | 注册/更新工作流定义 | body: `{ name, yaml, description? }` |
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
