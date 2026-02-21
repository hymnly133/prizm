# Prizm 流水线编写规范

本文档是工作流（流水线）YAML 的**完整编写规范**，与引擎实现、流水线 I/O 约定一致。工作流管理会话中会注入本规范，供 AI 按此生成或修改工作流定义。

## 一、设计原则（对齐引擎）

- **单一流水线输入/输出**：流水线只定义一个输入（`args` + `run.args`）和一个输出（**最后一步的输出**即流水线输出）。输入由首步通过 **inputParams** 消费；输出由末步的 `prizm_set_result` 提交，不另设流水线级输出存储。
- **以 schema 驱动结果**：所有 agent 步骤均按输出 schema 提交结果。若工作流**未定义** `outputs`（留空），则使用必选单字段 **output** 作为默认结果输出；若**定义了** `outputs`，则末步必须严格按该格式提交，提交后进行 schema 校验，与 prizm_set_result 要求对齐。
- **数据源单一**：流水线输入仅来自 `args` + `run.args`；流水线输出唯一来自最后一步的 `stepResults`；run 级 `finalOutput` / `finalStructuredOutput` 仅派生不持久化。
- **输入/输出形态对称**：`args` 与 `outputs` 均为「命名字段 + description + 可选 type」，分别传入首步与末步，做结构化对齐。
- **步骤间输入单一路径**：通过 `step.input` 显式引用（如 `$prev.output`、`$stepId.output`）或省略 input 时隐式继承上一步输出。

## 二、顶层结构

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 工作流名称，简洁无特殊字符，建议下划线命名（如 `daily_report`） |
| description | string | 否 | 工作流描述 |
| steps | WorkflowStepDef[] | 是 | 至少一个步骤，顺序执行 |
| args | Record<string, ArgSchema> | 否 | 流水线输入 schema，与 run.args 配合；首步通过 inputParams 注入 |
| outputs | Record<string, OutputSchema> | 否 | 流水线输出 schema，与 args 对称；末步按此结构化对齐输出 |
| config | WorkflowConfig | 否 | 错误策略、工作区模式、超时、通知等 |
| triggers | WorkflowTriggerDef[] | 否 | 声明式触发（如 todo_completed、document_saved） |

## 三、args（流水线输入）

与 `outputs` 对称，每参数支持：

- **description**：参数说明（强烈建议填写）
- **default**：默认值。**有 default（含空）即表示该参数可选**，运行时不填则用默认值；**无 default 即必填**。不使用单独的 optional 字段。
- **type**：可选，如 `string`、`natural_language`，用于说明/校验/UI

示例：

```yaml
args:
  query:
    description: 用户自然语言描述的需求或问题
    type: string
  topic:
    description: 主题关键词
    default: "通用"
```

- 有 `args` 且运行时传入 `run.args` 时，**首步**会收到 inputParams（schema + values），无需在首步用 `step.input` 再引用 `$args.xxx`。
- 未声明 `args` 但调用时传了 `options.args` 时，引擎会推断简易 schema，首步仍会收到 inputParams（单一路径）。
- **原始输入注入**：每次执行 agent 步骤时，系统会在该步骤的系统指令中注入本次流水线的原始输入（run.args），以便每一步都能参考用户启动时传入的参数。

## 四、outputs（流水线输出）

与 `args` 形态对称：**Record<string, { description?, type? }>**。每个输出字段的 **description** 可约定格式（如「以 Markdown 列表形式返回」）。

- **留空时**：流水线输出即末步的必选单字段 **output**（默认结果输出）；每一步的 prizm_set_result 均以单字段 `output` 为 schema。
- **非空时**：该 schema 传入**最后一步**为 outputParams，末步必须按此格式调用 prizm_set_result，提交后会进行 schema 校验；中间步骤仍使用单字段 `output`。流水线输出 = 最后一步按 def.outputs 提交的结构化结果。

示例：

```yaml
outputs:
  result:
    type: string
    description: 以 Markdown 列表形式返回的最终结果，每条一行
```

多字段：

```yaml
outputs:
  summary:
    type: string
    description: 简短摘要，纯文本
  list:
    type: string
    description: 详细结果，Markdown 格式的列表
```

不使用单独的 `outputFormat` 字段；格式约束写在各字段的 description 中。

## 五、步骤类型与字段

### 5.1 步骤类型

| type | 用途 | 必需字段 | 说明 |
|------|------|----------|------|
| agent | LLM 执行 | prompt | 由 BG Session 执行，prompt 描述本步任务 |
| approve | 人工审批 | approvePrompt | 暂停流程，等待用户批准/拒绝后 resume |
| transform | 本地变换 | transform | 不调 LLM，对 input 做 JSON dot-path 提取或表达式 |

### 5.2 通用可选字段（所有步骤）

- **id**：步骤标识，唯一；省略则自动生成
- **description**：步骤描述
- **input**：输入表达式，见下文「变量引用」
- **condition**：条件表达式；求值为 false 时本步 **skipped**
- **linkedActions**：步骤完成后执行的联动（如 create_todo、create_document、notify）

### 5.3 agent 步骤额外可选

- **model**：指定 LLM 模型
- **timeoutMs**：超时毫秒数
- **sessionConfig**：thinking、skills、allowedTools、outputSchema、expectedOutputFormat 等

### 5.4 transform 步骤

- **input**：引用上一步或某步输出（如 `$prev.output`、`$stepId.output`），默认 `{}`
- **transform**：dot-path 表达式，从 input（解析为 JSON）中提取，如 `data.title`

## 六、变量引用

在 **input**、**condition**、**linkedActions.params** 中可用：

| 语法 | 含义 |
|------|------|
| `$args.key` | 工作流启动参数（run.args） |
| `$prev.output` | 上一完成步骤的文本 output |
| `$stepId.output` | 指定步骤的 output |
| `$stepId.data.xxx` | 从步骤的 structuredData（JSON）中提取字段，支持深层如 `$stepId.data.a.b` |
| `$stepId.approved` | approve 步骤的审批结果 true/false |

- **首步**不建议用 `step.input: $args.xxx` 传参；流水线输入应通过 **inputParams** 注入（由 args + run.args 决定）。
- **非首步**省略 `input` 时，自动使用上一完成步骤的 output（隐式管道）。

## 七、条件与隐式管道

- **condition**：支持 `$stepId.approved`、`$stepId.output`（truthy）等，结果为 false 时该步 **skipped**。
- **input** 省略且非首步：自动使用 `$prev.output`。

## 八、config 常用项

- **errorStrategy**：`fail_fast`（默认）| `continue`，步骤失败时是否继续后续步骤
- **workspaceMode**：`dual` | `shared` | `isolated`
- **maxTotalTimeoutMs**：全局超时
- **maxStepOutputChars**：单步 output 最大字符，超出截断并追加 `... (truncated)`
- **notifyOnComplete** / **notifyOnFail**：是否发送系统通知

## 九、完整示例

### 9.1 无输入无输出（仅创建文档等侧效应）

```yaml
name: doc_only
description: 仅生成文档，无结构化输入输出
steps:
  - id: generate
    type: agent
    prompt: 根据当前日期生成一份今日待办模板文档，保存到工作区。
```

### 9.2 有输入无输出

```yaml
name: report_from_topic
description: 按主题生成报告，无声明式输出 schema
args:
  topic:
    description: 报告主题
    type: string
steps:
  - id: write_report
    type: agent
    prompt: 根据用户给定的主题撰写一份简短报告，并保存为工作区内的 Markdown 文件。
```

### 9.3 无输入有输出（Markdown 列表）

```yaml
name: list_output
description: 无参数，输出为 Markdown 列表
outputs:
  result:
    type: string
    description: 以 Markdown 列表形式返回的最终结果，每条一行
steps:
  - id: produce_list
    type: agent
    prompt: 生成一份包含 5 条的 Markdown 列表，内容为今日推荐事项。
```

### 9.4 有输入有输出（对称 I/O）

```yaml
name: query_to_list
description: 单参数自然语言输入，输出为 Markdown 列表
args:
  query:
    description: 用户自然语言描述的需求或问题
    type: string
outputs:
  result:
    type: string
    description: 以 Markdown 列表形式返回的最终结果，每条一行
steps:
  - id: answer
    type: agent
    prompt: 根据用户的自然语言问题，生成一份结构清晰的 Markdown 列表作为回答。
```

### 9.5 多步 + 隐式管道 + approve

```yaml
name: collect_review_publish
description: 收集 → 审批 → 发布
steps:
  - id: collect
    type: agent
    prompt: 收集数据并输出 JSON 摘要
  - id: review
    type: approve
    approvePrompt: 请审核上述摘要，批准或拒绝发布
  - id: publish
    type: agent
    prompt: 根据审核通过的摘要生成最终报告
    # input 省略，自动使用 $prev.output
```

## 十、命名与约束

- **name**：简洁、下划线风格，如 `data_processing`、`daily_report`
- **步骤 id**：同上，如 `fetch_data`、`generate_report`
- 仅使用已支持的 **step type**：`agent` | `approve` | `transform`
- 修改已有工作流时**基于上一版增量调整**，保留用户未提及部分不变
