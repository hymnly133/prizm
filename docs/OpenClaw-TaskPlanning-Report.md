# OpenClaw 任务规划系统深度剖析报告

> **撰写日期**: 2026-02-19
>
> **信息来源**: OpenClaw 官方文档 (docs.openclaw.ai)、GitHub 仓库 (github.com/openclaw/openclaw)、技术博客及社区文章

---

## 目录

1. [项目概述](#1-项目概述)
2. [核心架构设计](#2-核心架构设计)
3. [Agent Loop：推理-执行循环](#3-agent-loop推理-执行循环)
4. [任务规划与编排体系](#4-任务规划与编排体系)
5. [子智能体与并行执行](#5-子智能体与并行执行)
6. [持久化记忆系统](#6-持久化记忆系统)
7. [自动化调度系统](#7-自动化调度系统)
8. [工具系统与扩展机制](#8-工具系统与扩展机制)
9. [与其他框架的对比分析](#9-与其他框架的对比分析)
10. [总结与展望](#10-总结与展望)

---

## 1. 项目概述

### 1.1 什么是 OpenClaw

OpenClaw 是一个**开源的个人 AI 智能体框架**，定位为"能干活的 AI 操作系统"，而非简单的聊天机器人。它运行在用户本地设备上，采用**本地优先（local-first）** 的隐私架构，数据和凭证永远不会离开用户的设备。

**关键数据**：

| 指标 | 数值 |
|------|------|
| GitHub Stars | 207,709+ |
| Forks | 38,128 |
| 贡献者 | 370+ |
| 开源协议 | MIT |
| 主语言 | TypeScript (84.1%) |
| 最新版本 | v2026.2.17 |

### 1.2 核心能力

OpenClaw 不是一个对话式 AI，而是一个能够**执行实际操作**的数字员工：

- **多渠道接入**：WhatsApp、Telegram、Slack、Discord、Signal、iMessage、Microsoft Teams 等
- **系统操作**：管理邮件、日历、文件系统、Git 仓库、浏览器自动化
- **持续运行**：24/7 不间断工作，可设定定时任务、事件响应
- **跨会话记忆**：记住用户偏好、项目细节、对话历史
- **多模型支持**：Claude、GPT-4、Grok、Ollama 本地模型等

### 1.3 安装方式

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

安装后约 30 分钟即可通过配置文件完成个性化设定，包括 Agent 人格、工具权限、记忆策略和启动仪式。

---

## 2. 核心架构设计

OpenClaw 采用**四层分层架构**，从上到下依次为接入层、调度层、智能层和执行层。

### 2.1 Hub-and-Spoke 架构

整个系统以 **Gateway（网关）** 为核心，采用 Hub-and-Spoke（中心辐射）拓扑：

```
                    ┌──────────────┐
                    │   Gateway    │
                    │  (Daemon)    │
                    │  Port 18789  │
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
    │  macOS App  │ │    CLI      │ │   Web UI    │
    └─────────────┘ └─────────────┘ └─────────────┘
           │               │               │
    ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
    │  WhatsApp   │ │  Telegram   │ │   Slack     │
    └─────────────┘ └─────────────┘ └─────────────┘
```

**Gateway 职责**：

- WebSocket 服务器，处理消息路由、访问控制、会话管理和健康监控
- 维护所有消息平台连接
- 系统唯一的"真相源"（single source of truth）
- 暴露类型化的 WS API（请求、响应、服务端推送事件）
- 默认监听 `127.0.0.1:18789`

### 2.2 Brain-Hands 分离模型

OpenClaw 最核心的设计理念是**将 AI 推理（Brain）与系统执行（Hands）解耦**：

```
┌─────────────────────────────────────────────┐
│                   Brain                      │
│              (Reasoning Engine)               │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Claude   │  │ GPT-4    │  │ Ollama     │ │
│  │ Anthropic│  │ OpenAI   │  │ Local LLM  │ │
│  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────┬───────────────────────┘
                       │
            ┌──────────┴──────────┐
            │  Tool-Call Protocol │
            │   (JSON Payloads)   │
            └──────────┬──────────┘
                       │
┌──────────────────────┴───────────────────────┐
│                   Hands                       │
│            (Execution Environment)            │
│                                              │
│  ┌────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Shell  │  │ Browser  │  │ Filesystem  │  │
│  └────────┘  └──────────┘  └─────────────┘  │
│  ┌────────┐  ┌──────────┐  ┌─────────────┐  │
│  │  HTTP  │  │  Email   │  │  Calendar   │  │
│  └────────┘  └──────────┘  └─────────────┘  │
└──────────────────────────────────────────────┘
```

- **Brain（大脑）**：LLM 推理引擎，负责理解请求、制定计划、做出决策
- **Hands（双手）**：执行环境，负责 Shell 命令、文件操作、浏览器自动化、HTTP 请求等
- 两者之间通过**结构化的 Tool-Call 协议**（JSON 载荷）通信

### 2.3 插件扩展体系

OpenClaw 提供四大扩展点：

| 插件类型 | 功能 | 示例 |
|---------|------|------|
| Provider 插件 | 自定义 LLM 提供者 | 接入私有化部署的模型 |
| Tool 插件 | 自定义工具能力 | 数据库查询、API 调用 |
| Memory 插件 | 替代存储后端 | 向量数据库、云存储 |
| Channel 插件 | 新消息平台接入 | 企业微信、飞书 |

---

## 3. Agent Loop：推理-执行循环

Agent Loop 是 OpenClaw 任务规划的**基础执行单元**，也是理解整个系统的关键。

### 3.1 完整执行流程

```
消息到达 → 上下文组装 → 模型推理 → 工具执行 → 流式回复 → 状态持久化
  (1)         (2)          (3)        (4)         (5)          (6)
```

**详细步骤**：

1. **Intake（消息接收）**：通过 CLI 或 Gateway RPC 接收消息
2. **Context Assembly（上下文组装）**：加载工作空间文件（`SOUL.md`、`TOOLS.md`、`MEMORY.md`）和会话历史
3. **Model Inference（模型推理）**：LLM 根据上下文推理决策
4. **Tool Execution（工具执行）**：模型按需调用工具
5. **Streaming Replies（流式回复）**：结果实时流式返回
6. **Persistence（状态持久化）**：会话状态保存至磁盘

### 3.2 内部执行管线

从底层实现角度，Agent Loop 的执行管线如下：

```
agent RPC                     agentCommand              runEmbeddedPiAgent
    │                             │                           │
    ├─ 验证参数                    ├─ 解析模型 + 思考默认值     ├─ 通过 per-session + global 队列串行化
    ├─ 解析 session               ├─ 加载 Skills 快照          ├─ 解析模型 + auth profile
    ├─ 持久化 session 元数据       ├─ 调用 pi-agent-core 运行时  ├─ 订阅 pi events
    └─ 立即返回 { runId }         └─ 发出 lifecycle end/error   ├─ 流式传输 assistant/tool deltas
                                                               ├─ 强制超时 → 中止运行
                                                               └─ 返回 payloads + usage 元数据
```

### 3.3 会话串行化与并发控制

- 运行以**会话为粒度串行化**（session lane），防止工具/会话竞争
- 可选的**全局队列**（global lane）进一步控制并发
- 消息通道可选择队列模式：`collect`（收集）、`steer`（转向）、`followup`（跟进）

### 3.4 Prompt 组装

系统提示词由以下部分组装而成：

- OpenClaw 基础提示词
- Skills 提示词注入
- Bootstrap 上下文文件
- 运行时覆盖配置

模型特定的 token 限制和压缩保留 token 数会被强制执行。

### 3.5 超时与中止机制

| 超时类型 | 默认值 | 说明 |
|---------|--------|------|
| Agent 运行时超时 | 600s | `agents.defaults.timeoutSeconds`，在 `runEmbeddedPiAgent` 中强制执行 |
| `agent.wait` 超时 | 30s | 仅等待超时，不停止 Agent |
| Gateway 断连 | - | 触发 AbortSignal |

---

## 4. 任务规划与编排体系

OpenClaw 的任务规划不是单一机制，而是一个**多层次的编排体系**，从简单的响应式循环到复杂的 DAG 工作流，涵盖四种规划模式。

### 4.1 四种规划模式

```
复杂度 ↑
   │
   │  ┌────────────────────────────────────┐
   │  │  4. Multi-Step Workflows (Lobster) │  确定性 DAG 管线
   │  ├────────────────────────────────────┤
   │  │  3. Cron Jobs (定时调度)            │  精确定时触发
   │  ├────────────────────────────────────┤
   │  │  2. Heartbeat (心跳检测)            │  周期性上下文感知检查
   │  ├────────────────────────────────────┤
   │  │  1. Reactive Agent Loop (响应式)    │  收到消息即执行
   │  └────────────────────────────────────┘
   └─────────────────────────────────────── 灵活度 →
```

### 4.2 Lobster：确定性工作流运行时

**Lobster** 是 OpenClaw 的核心工作流引擎，是任务规划系统中最强大的组件。

#### 设计理念

传统 AI 工作流需要大量来回的工具调用，每次调用都消耗 token，且 LLM 必须编排每一步。Lobster 将编排逻辑**从 LLM 移到了类型化运行时**中：

| 传统方式 | Lobster 方式 |
|---------|-------------|
| 多次 LLM 工具调用 | 单次 Lobster 调用 |
| 每步消耗 token | 最小 token 开销 |
| LLM 编排每步 | 确定性管线执行 |
| 难以审计 | 管线即数据，可审计 |
| 无恢复机制 | 可暂停、可恢复 |

#### 核心特性

- **DAG 组合**：将 CLI 命令和工具调用组合为序列、并行分支和条件流
- **可恢复执行**：暂停的工作流返回 `resumeToken`，批准后可继续执行
- **审批门控**：副作用操作（发邮件、发评论）会暂停等待显式批准
- **JSON 管道**：步骤间通过 JSON 传递数据，自动序列化和类型检查
- **安全策略**：超时、输出上限、沙箱约束在运行时层面强制执行

#### 工作流文件格式 (.lobster)

```yaml
name: inbox-triage
args:
  tag:
    default: "family"
steps:
  - id: collect
    command: inbox list --json
  - id: categorize
    command: inbox categorize --json
    stdin: $collect.stdout
  - id: approve
    command: inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

#### 执行流程示例：邮件分拣

**没有 Lobster 时**（需要多轮对话）：

```
User: "检查我的邮件并起草回复"
→ openclaw 调用 gmail.list
→ LLM 总结
→ User: "给 #2 和 #5 起草回复"
→ LLM 起草
→ User: "发送 #2"
→ openclaw 调用 gmail.send
（每天重复，无分拣记忆）
```

**使用 Lobster 后**（单次管线调用）：

```json
{
  "action": "run",
  "pipeline": "email.triage --limit 20",
  "timeoutMs": 30000
}
```

返回审批请求：

```json
{
  "ok": true,
  "status": "needs_approval",
  "output": [{ "summary": "5 封需要回复, 2 封需要操作" }],
  "requiresApproval": {
    "type": "approval_request",
    "prompt": "发送 2 封草稿回复?",
    "resumeToken": "..."
  }
}
```

用户批准后一键恢复：

```json
{
  "action": "resume",
  "token": "<resumeToken>",
  "approve": true
}
```

#### LLM 步骤集成 (llm-task)

Lobster 支持在确定性管线中嵌入 LLM 推理步骤，通过 `llm-task` 插件工具实现结构化输出：

```lobster
openclaw.invoke --tool llm-task --action json --args-json '{
  "prompt": "分析输入邮件，返回意图和草稿",
  "input": { "subject": "Hello", "body": "Can you help?" },
  "schema": {
    "type": "object",
    "properties": {
      "intent": { "type": "string" },
      "draft": { "type": "string" }
    },
    "required": ["intent", "draft"]
  }
}'
```

### 4.3 ClawFlows：自然语言编排

ClawFlows 是更高层的抽象，允许用户用**自然语言描述自动化流程**，平台自动将其翻译为 YAML 管线定义（Lobster 格式），并在部署前提供人工审查。

### 4.4 OpenProse：Markdown 多智能体编排

OpenProse 提供基于 Markdown 的替代格式，用于多智能体编排：

- 显式控制流
- 并行执行
- 审批门控工作流
- 可与 Lobster 配合使用（Prose 编排准备工作，Lobster 执行确定性审批）

---

## 5. 子智能体与并行执行

### 5.1 核心概念

子智能体（Sub-Agents）是从现有 Agent 中**派生的后台运行实例**，用于并行执行任务而不阻塞主对话。每个子智能体拥有：

- 唯一标识符：`agent:agentId:subagent:uuid`
- 独立的上下文和执行环境
- 独立的对话历史

### 5.2 创建与配置

通过 `sessions_spawn` 工具或 `/subagents spawn` 命令创建：

```
/subagents spawn "分析这周的代码提交并生成周报"
  --model gpt-4o-mini    # 使用更廉价的模型降低成本
  --timeout 300           # 最大运行时间 300 秒
  --label "weekly-report" # 描述性标签
```

关键参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `task` | 子智能体的指令（必需） | - |
| `model` | 指定模型（可用廉价模型优化成本） | 继承父级 |
| `thinking` | 覆盖思考级别 | 继承父级 |
| `runTimeoutSeconds` | 最大执行时间 | 600s |
| `label` | 描述性标签 | - |
| `cleanup` | 完成后处理方式 | `keep` |

### 5.3 执行模型

```
主 Agent (Main)
    │
    ├─ spawn ──→ Sub-Agent A (后台)──→ 完成 ──→ announce 结果
    │                                            │
    ├─ spawn ──→ Sub-Agent B (后台)──→ 完成 ──→ announce 结果
    │                                            │
    ├─ (继续处理其他任务)                          │
    │                                            │
    └─ 接收 announce ←──────────────────────────┘
```

- `sessions_spawn` 是**非阻塞**操作，立即返回 `runId`
- 子智能体完成后通过 `announce` 步骤向请求者通道报告结果
- 结果包含：状态、摘要、token 用量、预估成本、运行时间

### 5.4 管理命令

| 命令 | 功能 |
|------|------|
| `/subagents list` | 查看所有运行中或最近完成的子智能体 |
| `/subagents info` | 获取详细元数据和会话标识符 |
| `/subagents log` | 检索对话历史和决策记录 |
| `/subagents send` | 与运行中的子智能体通信 |
| `/subagents stop/kill` | 终止子智能体 |

### 5.5 安全约束

- **禁止嵌套派生**：子智能体不能再派生子智能体（防止扇出爆炸）
- **会话隔离**：子智能体默认与主会话隔离
- **成本控制**：可为工作者 Agent 指定更廉价的模型

---

## 6. 持久化记忆系统

OpenClaw 的记忆系统是任务规划能力的重要支撑，使 Agent 能够跨会话保持上下文。

### 6.1 记忆文件结构

记忆以**纯 Markdown 文件**存储在 `~/.openclaw/memory/` 目录：

```
~/.openclaw/workspace/
├── MEMORY.md                    # 策展长期记忆（决策、偏好、持久事实）
└── memory/
    ├── 2026-02-19.md           # 当日日志（追加写入）
    ├── 2026-02-18.md           # 昨日日志
    ├── 2026-02-17.md           # ...
    ├── projects.md             # 常青文件（不受时间衰减影响）
    └── network.md              # 常青文件
```

**两层记忆**：

| 文件 | 用途 | 加载时机 |
|------|------|---------|
| `MEMORY.md` | 持久化知识（偏好、决策、关键事实） | 每次会话启动 |
| `memory/YYYY-MM-DD.md` | 日常日志（追加写入） | 加载当天 + 前一天 |

### 6.2 记忆生命周期

```
观察 → 提取 → 存储 → 检索 → 衰减
 │       │      │      │      │
 │       │      │      │      └─ 旧的、未使用的记忆逐渐降权
 │       │      │      └─ 新对话时检索相关记忆
 │       │      └─ 写入对应的 Markdown 文件
 │       └─ 从对话中提取关键信息
 └─ 对话过程中的观察
```

### 6.3 自动记忆刷新（压缩前触发）

当会话接近自动压缩阈值时，OpenClaw 触发一个**静默的 Agent 回合**，提醒模型将持久化记忆写入磁盘：

```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "会话即将压缩，请立即存储持久化记忆。",
          prompt: "将任何持久笔记写入 memory/YYYY-MM-DD.md；如无需存储则回复 NO_REPLY。"
        }
      }
    }
  }
}
```

### 6.4 向量记忆搜索

OpenClaw 在 Markdown 记忆文件上构建**小型向量索引**，支持语义查询：

**混合搜索架构**：

```
查询 → BM25 关键词搜索 ──┐
   │                      ├─→ 加权合并 → 时间衰减 → 排序 → MMR 多样性 → Top-K
   └→ 向量相似度搜索 ────┘
```

- **BM25**：精确 token 匹配（错误字符串、代码符号、ID）
- **向量搜索**：语义匹配（同义表述、概念相似）
- **时间衰减**：指数衰减因子，半衰期默认 30 天
- **MMR 重排**：最大边际相关性，平衡相关性和多样性

**嵌入模型支持**：

| 提供者 | 说明 |
|--------|------|
| OpenAI | text-embedding-3-small（远程） |
| Gemini | gemini-embedding-001（远程） |
| Voyage | Voyage embeddings（远程） |
| Local | node-llama-cpp + GGUF 模型（本地） |
| QMD | BM25 + 向量 + 重排序 本地侧车（实验性） |

### 6.5 会话记忆搜索（实验性）

可选索引会话记录，通过 `memory_search` 工具召回近期对话：

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        experimental: { sessionMemory: true },
        sources: ["memory", "sessions"]
      }
    }
  }
}
```

---

## 7. 自动化调度系统

### 7.1 Cron 定时调度

OpenClaw 内置 Gateway 级别的 Cron 调度器，支持任务跨重启持久化：

**三种调度类型**：

| 类型 | 格式 | 说明 |
|------|------|------|
| `cron` | 5-6 字段表达式 | 标准 cron 表达式定时 |
| `at` | 时间戳 | 一次性定时触发 |
| `every` | 间隔 | 周期性重复 |

**两种执行模式**：

| 模式 | 说明 |
|------|------|
| `isolated` | 启动独立的 Agent 会话执行 |
| `main` | 将系统事件排入主会话的下一次心跳 |

**示例**：

```bash
# 每天早上 7 点生成晨报
openclaw cron add --name "Morning brief" \
  --cron "0 7 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "总结一夜间的更新。" \
  --announce
```

任务持久化在 `~/.openclaw/cron/jobs.json`，Gateway 重启后自动恢复。

### 7.2 Heartbeat 心跳模式

心跳是一种**上下文感知的周期性检查**，默认间隔 30 分钟，与主会话共享状态：

| | Cron | Heartbeat |
|---|------|-----------|
| 适用场景 | 定时报告、每日任务 | 监控、反应式检查 |
| 时间精度 | 精确定时 | 周期性间隔 |
| 会话隔离 | 独立或主会话 | 共享主会话状态 |
| 触发方式 | 时间表达式 | 固定间隔 |

### 7.3 Hooks 事件钩子

OpenClaw 提供两层 Hook 系统：

**Gateway Hooks**（内部钩子）：

- 命令钩子：`/new`、`/reset`、`/stop` 等命令事件
- `agent:bootstrap`：在系统提示词最终确定前添加/移除 bootstrap 上下文文件
- 内置钩子包括：命令日志、会话记忆快照、bootstrap 文件注入

**Plugin Hooks**（插件钩子）：

| 钩子 | 触发时机 |
|------|---------|
| `gateway_start/stop` | Gateway 生命周期事件 |
| `session_start/end` | 会话边界 |
| `message_received/sending/sent` | 消息收发 |
| `before_tool_call/after_tool_call` | 工具调用前后 |
| `before_compaction/after_compaction` | 上下文压缩前后 |
| `agent_end` | Agent 运行结束 |
| `tool_result_persist` | 工具结果持久化前转换 |

### 7.4 Webhook 集成

- **入站 Webhook**：外部 HTTP 请求触发 Agent 操作
- **出站 Webhook**：Agent 事件通知外部服务

---

## 8. 工具系统与扩展机制

### 8.1 工具抽象层

OpenClaw 不硬编码行为，而是通过**显式、可检查、可授权的工具**工作：

- API 集成（Email、Calendar、GitHub 等）
- 系统操作（Shell、文件系统）
- 浏览器自动化
- 定时任务
- 自定义脚本

### 8.2 内置工具类别

| 类别 | 工具示例 |
|------|---------|
| Shell 执行 | `exec`、`process` |
| 文件系统 | `read_file`、`write_file`、`list_files` |
| 浏览器 | `browser_navigate`、`browser_click` |
| 记忆 | `memory_search`、`memory_get` |
| 子智能体 | `sessions_spawn` |
| 工作流 | `lobster`（插件） |
| LLM 任务 | `llm-task`（插件） |

### 8.3 权限控制

工具权限是 OpenClaw 的**一等公民**概念：

```json5
{
  "tools": {
    "allow": ["read_file", "write_file", "exec"],
    "alsoAllow": ["lobster"],
    "deny": ["browser_navigate"]
  }
}
```

支持全局配置和 per-agent 配置，插件工具默认禁用，需显式启用。

### 8.4 安全沙箱

- 工具执行在沙箱环境中，超时和输出上限在运行时强制执行
- `lobsterPath` 必须是绝对路径
- 沙箱模式下不可用的工具自动禁用
- 无密钥管理：工具本身不处理 OAuth，而是调用处理 OAuth 的 OpenClaw 工具

---

## 9. 与其他框架的对比分析

### 9.1 定位对比

| 特性 | OpenClaw | LangChain | AutoGPT | CrewAI |
|------|----------|-----------|---------|--------|
| **定位** | 个人 AI 操作系统 | LLM 应用开发框架 | 自主 AI 实验 | 多智能体协作 |
| **运行方式** | 本地守护进程 | 库/SDK | 独立运行 | 库/SDK |
| **数据隐私** | 完全本地 | 取决于实现 | 取决于实现 | 取决于实现 |
| **持续运行** | 原生支持 | 需自行实现 | 有限 | 需自行实现 |
| **消息平台** | 原生多平台 | 需额外集成 | 无 | 无 |
| **任务调度** | 内置 Cron + Heartbeat | 无 | 无 | 无 |
| **工作流引擎** | Lobster (确定性 DAG) | LangGraph | 无 | 无 |
| **记忆系统** | Markdown + 向量混合搜索 | 需额外集成 | 有限 | 有限 |

### 9.2 任务规划能力对比

| 规划特性 | OpenClaw | 传统 Agent 框架 |
|---------|----------|----------------|
| 响应式循环 | Agent Loop | Prompt Chain |
| 确定性管线 | Lobster DAG | 无原生支持 |
| 并行子任务 | Sub-Agents | 有限/无 |
| 定时自动化 | Cron + Heartbeat | 无 |
| 审批门控 | Resume Token | 需自行实现 |
| 状态恢复 | 原生支持 | 需自行实现 |
| 多智能体协作 | OpenProse + Sub-Agents | CrewAI 等 |

### 9.3 社区评价

根据 2026 年 2 月的 TechCrunch 报道，部分 AI 专家认为 OpenClaw 虽然获得了巨大关注（20 万+ Stars），但在某些方面仍存在争议：

- **支持者**认为它代表了 AI Agent 从"聊天"到"执行"的范式转变
- **质疑者**认为其架构复杂度较高，实际使用门槛不低
- **每日运行成本**约 $5-50（取决于使用量），使用本地模型可消除 API 成本

---

## 10. 总结与展望

### 10.1 核心优势

1. **本地优先、隐私安全**：所有数据和计算在本地完成
2. **多层次任务规划**：从响应式循环到确定性 DAG 管线，覆盖多种场景
3. **Brain-Hands 分离**：推理与执行解耦，模型可替换，工具可扩展
4. **持久化记忆**：Markdown 文件为真相源，支持混合检索（BM25 + 向量 + 时间衰减 + MMR）
5. **原生自动化**：Cron、Heartbeat、Hooks、Webhook 四重自动化机制
6. **确定性工作流**：Lobster 提供可审计、可恢复、可审批的管线执行
7. **成本可控**：支持本地模型、廉价模型用于子智能体

### 10.2 适用场景

- **个人效率**：邮件管理、日历安排、文件整理
- **开发工作流**：代码审查、CI/CD 监控、日报生成
- **数据处理**：定期数据采集、清洗、报告生成
- **监控告警**：系统状态检查、异常通知
- **知识管理**：笔记整理、知识库维护

### 10.3 对 Prizm 项目的借鉴

OpenClaw 的设计理念与 Prizm 项目有诸多可借鉴之处：

| OpenClaw 特性 | Prizm 对应 | 借鉴方向 |
|---------------|------------|---------|
| Brain-Hands 分离 | Adapter 模式 | 已有类似设计 |
| Lobster DAG 管线 | 无直接对应 | 可考虑引入确定性工作流引擎 |
| Sub-Agents | 无直接对应 | 可考虑并行子任务机制 |
| Markdown 记忆 | Evermemos | 已有更复杂的记忆系统 |
| Cron 调度 | 无直接对应 | 可考虑内置定时任务 |
| 审批门控 | 无直接对应 | 可考虑关键操作的审批流 |
| 混合搜索 | localEmbedding | 可增加 BM25 + 时间衰减 |

---

> **参考链接**
>
> - OpenClaw 官方文档: https://docs.openclaw.ai/
> - GitHub 仓库: https://github.com/openclaw/openclaw
> - Lobster 工作流引擎: https://docs.openclaw.ai/tools/lobster
> - Agent Loop 文档: https://docs.openclaw.ai/concepts/agent-loop
> - 记忆系统文档: https://docs.openclaw.ai/concepts/memory
> - 架构设计: https://docs.openclaw.ai/concepts/architecture
> - 子智能体文档: https://docs.openclaw.ai/tools/subagents
> - Cron 调度文档: https://docs.openclaw.ai/automation/cron-jobs
> - 中文社区博客: https://juejin.cn/post/7603185231802007578
> - 中文架构分析: https://aix.me/blog/openclaw_architecture/
