# Prizm Agent 优化方案

> 基于对 Manus Agent、Devin AI、Cursor Agent 2.0、Claude Code、Lovable、Cline 等顶级 AI Agent 系统提示词的对比分析，针对 prizm 项目 agent 模块提出的系统性优化建议。
>
> 分析日期：2026-02-16

---

## 优化原则

> **不改动服务型业务逻辑**。本方案仅涉及提示词文本、工具描述文本、以及独立的工程层优化（并行执行、错误重试）。记忆注入策略、上下文压缩逻辑、ScopeStore 等核心业务模块不在本次改动范围内。

## 目录

- [现状分析](#现状分析)
- [优化一：系统提示词增强](#优化一系统提示词增强)
- [优化二：工具描述与使用策略](#优化二工具描述与使用策略)
- [优化三：响应风格引导](#优化三响应风格引导)
- [优化四：并行工具执行](#优化四并行工具执行)
- [优化五：工具调用错误重试](#优化五工具调用错误重试)
- [长期演进方向](#长期演进方向)
- [实施优先级](#实施优先级)
- [附录：参考提示词关键模式摘录](#附录参考提示词关键模式摘录)

---

## 现状分析

### 当前架构亮点

prizm agent 已具备扎实的架构基础：

| 能力 | 实现 | 评价 |
|------|------|------|
| 三层记忆系统 | User / Scope / Session，SQLite + LanceDB | ★★★★ 优秀 |
| A/B 滑动窗口压缩 | fullContextTurns(4) + cachedContextTurns(3) | ★★★ 良好 |
| SSE 流式响应 | text / reasoning / tool_call / tool_result_chunk / done | ★★★★ 优秀 |
| MCP 外部工具集成 | McpClientManager 多传输协议支持 | ★★★★ 优秀 |
| @引用系统 | @note / @doc / @todo 自动注入内容 | ★★★★ 优秀 |
| 工作区上下文 | scopeContext 智能摘要注入 | ★★★ 良好 |
| 多 LLM 提供商 | MiMo / Zhipu / OpenAI 优先级切换 | ★★★ 良好 |

### 核心差距

与顶级 agent 系统对比后，主要差距集中在以下维度：

| 维度 | 当前状态 | 参考水平 | 差距 | 本次优化 |
|------|----------|----------|------|----------|
| 系统提示词深度 | ~200 字，仅角色+能力+原则 | 2000-5000 字，含多维度行为指导 | **高** | ✅ 优化一 |
| 工具描述质量 | 一句话描述 | 含 when to use / returns / vs 说明 | **高** | ✅ 优化二 |
| 响应格式规范 | 无 | 明确的风格、格式、引用规范 | **中** | ✅ 优化三 |
| 工具执行策略 | 串行 | 并行 + 重试 | **中** | ✅ 优化四/五 |
| 思考与规划引导 | 无 | 显式 think / plan 模式 | **中** | 📌 长期方向 |
| 记忆注入策略 | 固定限制 (3/5/5) | 按相关性/消息复杂度动态调整 | **中** | ⏭ 不改动 |
| 上下文压缩 | 仅 EventLog | 多类型提取 | **中** | ⏭ 不改动 |

---

## 优化一：系统提示词增强

**影响**：★★★★★（最高）  
**难度**：★☆☆☆☆（最低）  
**涉及文件**：`prizm/src/llm/systemPrompt.ts`

### 问题

当前系统提示词（`buildSystemPrompt`）仅约 200 字，结构为：

```
角色定义（1 句）→ 工作区上下文 → 能力列表（4 条）→ 原则（2 条）
```

对比参考系统：

- **Manus**：按模块拆分（planner / knowledge / datasource / todo / message / file / info / browser / shell / coding / error_handling），每个模块 3-10 条规则
- **Devin**：分 Planning 与 Standard 两种模式，含显式 `<think>` 工具使用时机指导（10 个场景）
- **Cursor 2.0**：含 `maximize_context_understanding` 段落，要求多轮搜索确认后再回答

### 建议改进

将系统提示词从"平铺声明"升级为"分模块行为指导"：

```typescript
// systemPrompt.ts - 建议结构

function buildSystemPrompt(options: SystemPromptOptions): string {
  const parts: string[] = []

  // ===== 1. 角色定义（增强版） =====
  parts.push(
    '你是 Prizm 工作区助手，帮助用户管理便签、待办、文档，' +
    '并基于记忆提供个性化协助。你高效、准确、简洁。'
  )

  // ===== 2. 工作区上下文（已有，保持） =====
  if (includeScopeContext) {
    // ... 现有 scopeContext 逻辑 ...
  }

  // ===== 3. 能力与数据（已有，增强工具指引） =====
  parts.push('## 能力与数据')
  parts.push('- 工具：便签/待办/文档的读建改删；@note/@doc/@todo 引用时内容已附上')
  parts.push('- 记忆：每条消息注入 [User/Scope/Session Memory] 相关片段；' +
    '需更多时调用 prizm_search_memories / prizm_list_memories')
  parts.push('- 检索：prizm_search 全文匹配优先；' +
    'prizm_search_memories 用于语义/模糊查询')
  parts.push('- 联网：tavily_web_search 用于需要实时信息的查询（需启用）')

  // ===== 4. 新增：工作方式 =====
  parts.push('')
  parts.push('## 工作方式')
  parts.push('- 简单查询：直接用工作区数据和记忆回答，无需调用工具')
  parts.push('- 需要数据：先 list/search 确认，再 read 获取详情')
  parts.push('- 创建/修改：先确认用户意图，执行后反馈结果')
  parts.push('- 删除操作：必须二次确认')
  parts.push('- 复杂任务：先理解需求、列出步骤，逐步执行并反馈进度')
  parts.push('- 失败时：分析原因，换方法重试一次；仍失败则如实告知')

  // ===== 5. 新增：工具使用优先级 =====
  parts.push('')
  parts.push('## 工具选择')
  parts.push('- 查找已知 ID 的条目 → read（直接读取）')
  parts.push('- 查找内容中的关键词 → prizm_search（全文匹配）')
  parts.push('- 回忆过往对话/用户偏好 → prizm_search_memories（语义搜索）')
  parts.push('- 确认数据全貌 → list + scope_stats')
  parts.push('- 修改前先 read 确认现有内容，避免覆盖')
  parts.push('- 可组合使用：list → read → update（查 → 看 → 改）')

  // ===== 6. 新增：回复规范 =====
  parts.push('')
  parts.push('## 回复规范')
  parts.push('- 简洁为主，不重复工作区上下文中已展示的内容')
  parts.push('- 引用来源：[note:ID]、[todo:ID]、[doc:ID]')
  parts.push('- 多项内容使用结构化格式')
  parts.push('- 跟随用户的语言（中文/英文）')

  return parts.join('\n')
}
```

### 关键改进点

| 新增模块 | 参考来源 | 作用 |
|----------|----------|------|
| 工作方式 | Devin 的 Planning + Manus 的 agent_loop | 引导 LLM 按步骤处理复杂任务 |
| 工具选择 | Cursor 的 tool description + Manus 的 info_rules | 减少不必要的工具调用，提升选择准确率 |
| 回复规范 | Lovable 的 BE CONCISE + Claude Code 的 tone_and_style | 统一输出风格 |

### 预期效果

- 减少 LLM 不必要的工具调用（当前可能在工作区上下文已含答案时仍调用 list）
- 提升复杂任务的完成率（多步骤分解）
- 减少误操作（修改/删除前确认）
- 统一响应风格

---

## 优化二：工具描述与使用策略

**影响**：★★★★☆  
**难度**：★★☆☆☆  
**涉及文件**：`prizm/src/llm/builtinTools.ts`

### 问题

当前工具描述均为一句话，例如：

```typescript
tool('prizm_search', '在工作区便签、待办、文档中全文搜索。', { ... })
tool('prizm_list_notes', '列出当前工作区的便签，含分组与字数。', { ... })
```

LLM 缺乏足够信息判断何时应该用哪个工具，导致：

- 误用（该用 search 时用了 list_notes + list_todos + list_documents 三次调用）
- 漏用（不知道 search_memories 可以做语义搜索）
- 多余调用（scope_stats 和 list 返回信息有重叠）

### 参考模式

Cursor Agent 2.0 的工具描述结构：

```
codebase_search: semantic search that finds code by meaning, not exact text

### When to Use This Tool
Use when you need to:
- Explore unfamiliar codebases
- Find code by meaning rather than exact text

### When NOT to Use
Skip for:
1. Exact text matches (use `grep`)
2. Reading known files (use `read_file`)

### Examples
<example>
Query: "Where is interface MyInterface implemented?"
// Good: Complete question with specific context
</example>
```

### 建议改进

```typescript
// builtinTools.ts - 增强版工具描述示例

tool(
  'prizm_search',
  '在工作区便签、待办、文档中全文搜索关键词。' +
  '当用户询问特定内容但不确定在哪个类型中时使用。' +
  '返回匹配条目列表（类型+ID+标题）。' +
  '优先用于精确/关键词查询。' +
  '语义模糊查询请改用 prizm_search_memories。',
  { properties: { query: { type: 'string', description: '搜索关键词或短语' } }, required: ['query'] }
),

tool(
  'prizm_search_memories',
  '按语义搜索用户的长期记忆（过往对话、偏好、习惯）。' +
  '当用户问"我之前说过什么"、"上次聊了什么"、"我的偏好是什么"时使用。' +
  '与 prizm_search 不同：这是向量语义搜索，适合模糊/意图性查询。' +
  '返回相关记忆片段列表。',
  { properties: { query: { type: 'string', description: '搜索问题或关键短语' } }, required: ['query'] }
),

tool(
  'prizm_list_notes',
  '列出当前工作区所有便签的概要（ID、内容摘要、标签、字数）。' +
  '当需要浏览便签全貌或查找特定便签的 ID 时使用。' +
  '无需参数。如果只需查找特定内容，优先使用 prizm_search。',
  { properties: {}, required: [] }
),

tool(
  'prizm_create_note',
  '创建一条新便签。创建前应确认用户意图（避免意外创建）。' +
  '返回新建便签的 ID。',
  {
    properties: {
      content: { type: 'string', description: '便签内容（纯文本）' },
      tags: { type: 'array', items: { type: 'string' }, description: '可选标签列表，用于分类' }
    },
    required: ['content']
  }
),

tool(
  'prizm_update_note',
  '更新已有便签的内容或标签。' +
  '修改前建议先 prizm_read_note 确认当前内容。' +
  '仅传入需要修改的字段，未传入的字段保持不变。',
  {
    properties: {
      noteId: { type: 'string', description: '目标便签 ID' },
      content: { type: 'string', description: '新内容（不传则不修改）' },
      tags: { type: 'array', items: { type: 'string' }, description: '新标签列表（不传则不修改）' }
    },
    required: ['noteId']
  }
),

tool(
  'prizm_create_todo',
  '创建一条待办项。必须指定 listId（追加到已有列表）或 listTitle（新建列表并添加），二者必填其一。' +
  '不确定有哪些列表时，先调用 prizm_list_todo_lists 查看。',
  { /* ... properties ... */ }
)
```

### 核心原则

每个工具描述应覆盖：

| 要素 | 说明 | 示例 |
|------|------|------|
| **做什么** | 工具的核心功能 | "全文搜索便签/待办/文档" |
| **何时用** | 触发条件 | "当不确定内容在哪个类型中时" |
| **返回什么** | 输出格式 | "返回匹配条目列表（类型+ID+标题）" |
| **何时不用** | 区分相似工具 | "语义模糊查询请改用 search_memories" |
| **前置建议** | 推荐先做什么 | "修改前建议先 read 确认当前内容" |

---

## 优化三：响应风格引导

**影响**：★★★☆☆  
**难度**：★☆☆☆☆  
**涉及文件**：`prizm/src/llm/systemPrompt.ts`  
**改动范围**：仅提示词文本

### 参考模式对比

| 系统 | 风格策略 |
|------|----------|
| Claude Code | 极简：< 4 行，直接回答，不加前后缀 |
| Lovable | 简洁：< 2 行解释 + 直接操作 |
| Manus | 散文式：避免纯列表，使用段落，长文 > 数千字 |
| Devin | 专注：只在关键时刻与用户通信 |
| Cursor 2.0 | 平衡：简洁 + 必要时详细 |

### 建议

Prizm 作为桌面效率工具助手，最适合 **Cursor 2.0 的平衡风格**。在系统提示词中追加：

```
## 回复风格
- 日常操作（CRUD）：简洁确认，如"已创建便签 xxx"
- 查询类：直接给出结果，需要时附带简要说明
- 复杂任务：先列出计划步骤，逐步执行并反馈
- 不确定时：坦诚说明，给出最佳猜测和替代方案
- 跟随用户语言：用户用中文则中文回复，用英文则英文回复
```

---

## 优化四：并行工具执行

**影响**：★★★☆☆  
**难度**：★★★☆☆  
**涉及文件**：`prizm/src/adapters/default.ts`  
**改动范围**：工具执行调度逻辑（不涉及业务逻辑本身）

### 问题

当前工具执行是严格串行的（第 714-796 行）：

```typescript
for (const tc of toolCalls) {
  yield { toolCall: { ...tc, status: 'running' } }
  const result = await executeToolCall(tc)
  yield { toolCall: { ...tc, result, status: 'done' } }
  currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })
}
```

当 LLM 一次返回多个独立工具调用时（如同时 list_notes + list_todos），它们被串行等待，浪费时间。

### 参考模式

- **Cursor 2.0**："batch your tool calls together for optimal performance"
- **Lovable**："MAXIMIZE EFFICIENCY: whenever you need to perform multiple independent operations, always invoke all relevant tools simultaneously"

### 建议改进

```typescript
// default.ts - 并行工具执行

// 1. 先发出所有 running 状态
for (const tc of toolCalls) {
  yield {
    toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments,
                result: '', status: 'running' as const }
  }
}

// 2. 并行执行所有工具（内置工具互不依赖，MCP 工具也独立）
const execPromises = toolCalls.map(async (tc) => {
  try {
    const args = JSON.parse(tc.arguments || '{}')
    let text: string
    let isError = false
    if (BUILTIN_TOOL_NAMES.has(tc.name)) {
      const result = await executeBuiltinTool(scope, tc.name, args, sessionId)
      text = result.text; isError = result.isError ?? false
    } else if (tc.name === 'tavily_web_search') {
      // ... tavily logic ...
    } else {
      // ... mcp logic ...
    }
    return { tc, text, isError }
  } catch (err) {
    return { tc, text: `Error: ${err instanceof Error ? err.message : err}`, isError: true }
  }
})

const results = await Promise.all(execPromises)

// 3. 按顺序 yield 结果（保持消息顺序一致性）
for (const { tc, text, isError } of results) {
  // stream large results if needed
  if (text.length >= TOOL_RESULT_STREAM_THRESHOLD) {
    for (let i = 0; i < text.length; i += TOOL_RESULT_CHUNK_SIZE) {
      yield { toolResultChunk: { id: tc.id, chunk: text.slice(i, i + TOOL_RESULT_CHUNK_SIZE) } }
    }
  }
  yield {
    toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments,
                result: text, isError, status: 'done' as const }
  }
  currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: text })
}
```

### 注意事项

- 这是纯调度层改动，不修改任何工具的执行逻辑或业务逻辑
- 内置的读操作（list/read/search/stats）完全可以并行
- 写操作保持原有行为，由 scopeStore 保证一致性
- 如需保守实施，可仅对读操作启用并行

### 预期效果

- 多工具场景（如 list_notes + list_todos + list_documents）从 3 次 RTT 降为 1 次
- 搜索场景中 prizm_search + prizm_search_memories 可并行执行

---

## 优化五：工具调用错误重试

**影响**：★★☆☆☆  
**难度**：★★☆☆☆  
**涉及文件**：`prizm/src/adapters/default.ts`  
**改动范围**：工具调用 catch 块（不涉及业务逻辑本身）

### 问题

工具执行失败时直接将错误信息返回给 LLM，无重试机制。对于 MCP 外部工具调用，网络抖动等瞬态错误较常见。

### 参考模式

Manus 的 error_handling：
> "When errors occur, first verify tool names and arguments. Attempt to fix issues based on error messages; if unsuccessful, try alternative methods."

### 建议改进

仅在已有 catch 块中增加瞬态错误重试，不改变业务逻辑：

```typescript
// default.ts - 在已有 catch 块中增加重试

try {
  result = await executeToolCall(tc)
} catch (err) {
  // 对瞬态网络错误重试一次
  if (isTransientError(err)) {
    await sleep(500)
    try {
      result = await executeToolCall(tc)
    } catch (retryErr) {
      result = { text: `Error (重试后仍失败): ${retryErr.message}`, isError: true }
    }
  } else {
    result = { text: `Error: ${err.message}`, isError: true }
  }
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('ECONNRESET') ||
         msg.includes('ETIMEDOUT') ||
         msg.includes('socket hang up')
}
```

### 注意事项

- 仅对 catch 到的异常做重试，不影响正常执行路径
- 仅重试一次，避免无限循环
- 仅对网络瞬态错误重试，业务错误（如"便签不存在"）不重试

---

## 长期演进方向

以下为更大范围的架构演进，需要较多开发资源，可作为后续规划：

### 1. 规划模式（参考 Devin）

为复杂任务引入"先规划，再执行"的两阶段模式：

```
用户: "帮我整理本周的工作，把完成的待办归档到文档中"

Agent 规划阶段:
1. 列出所有待办列表
2. 筛选状态为 done 的项
3. 按列表分组
4. 创建归档文档
5. 将完成项写入文档
6. 确认是否删除已归档的待办

Agent 执行阶段:
[逐步执行上述计划，每步反馈进度]
```

### 2. 知识模块（参考 Manus）

为特定任务类型注入领域知识：

```typescript
// 示例：当检测到用户在做"周报"相关操作时
const knowledgeHint = `
[知识提示] 生成周报时建议：
- 查看本周创建/更新的便签和文档
- 统计本周完成的待办项
- 按项目/分类汇总
`
```

### 3. 事件流架构（参考 Manus）

将 agent 循环从"请求-响应"升级为事件流：

```
Event: UserMessage → 用户发送消息
Event: Plan → 系统生成任务计划
Event: Action → 执行工具调用
Event: Observation → 工具返回结果
Event: Knowledge → 注入相关知识
Event: Response → 生成回复
```

### 4. 自适应 Token 预算

根据模型能力和对话长度动态调整各部分的 token 分配：

```
总预算: 8192 tokens
├── System Prompt: 800 (固定)
├── Scope Context: min(数据量, 1500) (动态)
├── Memory Injection: min(相关记忆, 800) (动态)
├── Conversation History: 剩余空间 (动态)
└── 预留回复: 2000 (固定)
```

---

## 实施优先级

| 优先级 | 优化项 | 影响 | 难度 | 改动范围 | 预估工时 |
|--------|--------|------|------|----------|----------|
| P0 | 系统提示词增强 | ★★★★★ | ★☆☆☆☆ | 仅提示词文本 | 2h |
| P0 | 工具描述增强 | ★★★★☆ | ★★☆☆☆ | 仅描述字符串 | 2h |
| P0 | 响应风格引导 | ★★★☆☆ | ★☆☆☆☆ | 仅提示词文本 | 1h |
| P1 | 并行工具执行 | ★★★☆☆ | ★★★☆☆ | 调度层 | 4h |
| P1 | 工具调用错误重试 | ★★☆☆☆ | ★★☆☆☆ | catch 块 | 2h |
| — | 规划模式 | ★★★☆☆ | ★★★★★ | 长期方向 | 8h+ |
| — | 知识模块 | ★★☆☆☆ | ★★★★☆ | 长期方向 | 6h+ |
| — | 事件流架构 | ★★☆☆☆ | ★★★★★ | 长期方向 | 16h+ |

**建议实施路径**：P0（提示词文本，半天完成）→ P1（工程层优化，一周内完成）→ 长期方向（按需迭代）

> 注意：P0 和 P1 均不改动记忆注入、上下文压缩、ScopeStore 等服务型业务逻辑。

---

## 附录：参考提示词关键模式摘录

### A. Manus Agent - 模块化规则系统

Manus 的核心特点是将 agent 行为拆分为独立模块，每个模块有自己的规则集：

```
<planner_module>     任务规划，伪代码表示步骤
<knowledge_module>   按条件注入领域知识
<datasource_module>  数据 API 优先于网络搜索
<todo_rules>         todo.md 作为进度追踪清单
<message_rules>      notify(非阻塞) vs ask(阻塞) 双模式沟通
<info_rules>         信息优先级：API > 搜索 > 模型知识
<error_handling>     重试 → 替代方案 → 报告用户
```

最值得 prizm 借鉴的是 **todo_rules**（任务追踪）和 **error_handling**（错误恢复）。

### B. Devin AI - 思考工具

Devin 显式定义了 `<think>` 工具的使用时机：

```
必须使用 <think> 的场景：
1. 做关键决策前（如 git 操作）
2. 从探索/理解代码过渡到修改代码时
3. 报告完成前（自检是否真正完成）

建议使用 <think> 的场景：
1. 没有清晰的下一步时
2. 下一步的细节不明确时
3. 遇到意外困难时
4. 多次尝试失败时
5. 做出关键决策时
```

这种显式思考对 prizm 的价值在于：复杂操作（如批量修改、数据迁移）前先让 LLM "想清楚"。

### C. Cursor 2.0 - 上下文理解最大化

```
<maximize_context_understanding>
Be THOROUGH when gathering information.
Make sure you have the FULL picture before replying.
TRACE every symbol back to its definitions and usages.
Look past the first seemingly relevant result.
EXPLORE alternative implementations, edge cases, and varied search terms
until you have COMPREHENSIVE coverage of the topic.

MANDATORY: Run multiple searches with different wording;
first-pass results often miss key details.
</maximize_context_understanding>
```

这个模式对 prizm 的搜索场景有参考价值：当用户问模糊问题时，应组合使用 prizm_search + prizm_search_memories 获取全面结果。

### D. Lovable - 高效工具使用

```
CARDINAL RULES:
1. NEVER read files already in context (避免重复读取)
2. ALWAYS batch multiple operations when possible (批量操作)
3. NEVER make sequential tool calls that could be combined (避免串行)
4. Use the most appropriate tool for each task (选择最合适的工具)
```

对 prizm 的启示：系统提示词中应明确告知 LLM，工作区上下文已包含近期数据，无需重复调用 list 获取。

---

*文档版本：v1.0 | 最后更新：2026-02-16*
