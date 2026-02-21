# 新增「管理会话」类型指南

与工作流管理会话（`tool_workflow_management`）类似的管理会话，都遵循「场景 × 配方 × 片段」约定。按下面清单做即可保持约定一致并高效开发提示词。

---

## 一、约定总览

| 层级 | 作用 | 你需做的 |
|------|------|----------|
| **场景 (Scenario)** | 决定用哪套配方、哪些片段 | 在枚举里加一种，在 `resolveScenario` 里识别 |
| **配方 (Recipe)** | 规定 static / perTurn 用哪些片段、顺序、是否接受 preamble | 在 `recipe.ts` 为新区加一条 |
| **片段 (Segment)** | 产出某一块提示词（身份、规则、上下文等） | 需要专属块时加新 SegmentId + 建造器 |
| **工具集** | 该会话能用哪些工具 | 在 adapter 里按 session 类型过滤/追加工具 |
| **入口** | 谁创建这类 session、传什么 context | 自己的 Manager/API 创建 `kind: 'tool'` + `toolMeta.source` |

**Cache 约定**：会话内不变的内容只放在 **sessionStatic**（身份、schema、规则、env）；每轮会变的内容（当前编辑对象、用户输入摘要等）只放在 **perTurnDynamic**，这样 `messages[0]` 稳定，前缀缓存有效。

---

## 二、操作清单（按顺序）

### 1. 定义「来源」常量（prizm-shared）

在 `prizm-shared/src/constants.ts` 里增加你的管理类型来源，与工作流管理并列：

```ts
export const WORKFLOW_MANAGEMENT_SOURCE = 'workflow-management' as const  // 已有
export const XXX_MANAGEMENT_SOURCE = 'xxx-management' as const            // 新增
```

若需要 token 统计/展示分类，在 `domain.ts` 的 `TokenUsageCategory` 等处加对应枚举（可选）。

### 2. 会话如何被识别（prizm-shared）

在 `prizm-shared/src/domain.ts` 中：

- 若与工作流管理**完全同构**（仅 source 不同），可复用 `isToolSession`，用 `toolMeta.source === XXX_MANAGEMENT_SOURCE` 区分。
- 若需要独立判断函数，仿照 `isWorkflowManagementSession` 写 `isXxxManagementSession(session)`，内部判断 `kind === 'tool' && toolMeta?.source === XXX_MANAGEMENT_SOURCE`（以及是否兼容 legacy background，按需）。

### 3. 新增场景枚举（promptPipeline）

在 `prizm/src/llm/promptPipeline/types.ts`：

- `PromptScenario` 联合类型里加一项，例如：`| 'tool_xxx_management'`。
- 若该场景有**专属上下文块**或**专属身份**，在 `SegmentId` 里加对应 ID，例如：`'identity_xxx'`、`'xxx_management_context'`、`'xxx_edit_context'`（perTurn 用，cache 友好）。
- 若需要从 context 传「当前编辑对象」等每轮数据，在 `PromptBuildContext` 里加可选字段，例如：`xxxEditContext?: string`。

### 4. 场景解析（promptPipeline）

在 `prizm/src/llm/promptPipeline/scenario.ts` 的 `resolveScenario` 里：

- 在 `isWorkflowManagementSession(session)` 之后（或之前，视优先级）增加对 `isXxxManagementSession(session)` 的判断，返回 `'tool_xxx_management'`。
- 保证同一 session 只会落到一个场景。

### 5. 配方（promptPipeline）

在 `prizm/src/llm/promptPipeline/recipe.ts` 的 `RECIPES` 里为新场景加一条：

- **sessionStatic**：列出该场景下会话内不变的片段顺序。  
  - 通常包含：专属身份（如 `identity_xxx`）、`rules`、`env`、专属上下文（如 `xxx_management_context`）、`skills`。  
  - 不包含通用 `instructions`（除非你刻意要通用工具路由）；不包含「当前编辑内容」。
- **acceptCallerPreamble**：若像 BG 那样由调用方传入一大段说明，设为 `true`，否则 `false`。
- **perTurnDynamic**：列出每轮变化的片段。  
  - 例如：`xxx_edit_context`（当前编辑对象）、`active_locks`；一般不需要 `workspace_context` / `memory_profile` / `prompt_injection`（除非产品明确要）。

### 6. 片段建造器（promptPipeline）

- **身份 / 静态说明**（会话内不变）  
  - 新建 `segments/identityXxx.ts`：仅在 `scenario === 'tool_xxx_management'` 时返回你的专家身份 + schema/规则/输出格式，其余场景返回 `''`。  
  - 新建 `segments/xxxManagementContext.ts`：仅在对应场景返回 `<xxx-management-context>…</xxx-management-context>`（工作区、约束等）。
- **每轮编辑上下文**（cache 友好，放 perTurn）  
  - 新建 `segments/xxxEditContext.ts`：从 `ctx.xxxEditContext` 读入，包成 `<current_definition>` 或你约定的标签，仅在对应场景且有内容时返回非空。
- 在 `segments/index.ts` 的 `SEGMENT_BUILDERS` 里注册上述新 `SegmentId`。

这样：**身份 + 规则 + env** 在 static，**当前编辑对象** 在 perTurn，符合 cache 约定。

### 7. 上下文入参（promptPipeline + chatCore/adapter）

- 在 `PromptBuildContext` 中已有 `workflowEditContext` 示例；若新类型需要传入「当前编辑内容」，增加 `xxxEditContext?: string`。
- 在 `PromptContextInput`（context.ts）中增加对应字段。
- 谁创建该管理会话（你的 Manager 或 API），在调用 chatCore 时在 options 里传 `workflowEditContext` / `xxxEditContext`（或你命名的字段）；chatCore 再传给 adapter.chat。  
- 若采用「调用方整段 preamble」方式，可继续用 `callerPreamble`（即现有 `systemPreamble`），并在配方里 `acceptCallerPreamble: true`。

### 8. 工具集（adapter）

在 `DefaultAgentAdapter.chat` 中，工具列表在 `filterWorkflowBuilderForSession` 之后、按 session 类型追加/过滤：

- 工作流管理：`isWorkflowManagementSession(sessionData)` 时只去掉 `prizm_navigate`，保留 `prizm_workflow` 及 create/update 工具。
- 新类型：仿照这里，用 `isXxxManagementSession(sessionData)`，只保留该类型需要的工具（例如只有 `xxx_submit`），并从全量工具里剔除不需要的（如 `prizm_navigate` 等）。  
- 若逻辑较多，可抽成 `sessionToolFilter.ts` 里的 `filterXxxForSession(tools, sessionData)`，再在 adapter 里调用。

### 9. 入口与 session 创建

- 创建会话时：`kind: 'tool'`，`toolMeta: { source: XXX_MANAGEMENT_SOURCE, label: '…', … }`。
- 调用 chatCore 时传入：`scope`、`sessionId`、`content`、以及 `workflowEditContext` / `xxxEditContext`（或 `callerPreamble`）等，与 `PromptContextInput` 一致。

---

## 三、提示词开发效率建议

1. **先写「目标 prompt」再拆成片段**  
   先在一份文档里写出该管理会话的完整 system 目标（身份、规则、当前编辑块、约束），再按「会话内不变 → sessionStatic」「每轮变化 → perTurnDynamic」拆成现有或新建的片段。

2. **尽量复用现有片段**  
   `rules`、`env`、`skills`、`active_locks` 可直接放进配方；只有该类型特有的身份/约束/当前编辑再新建 `identity_xxx`、`xxx_management_context`、`xxx_edit_context`。

3. **专属身份单独文件**  
   把「专家身份 + schema + 规则 + 输出格式」放在单独文件（如 `llm/xxxPrompt.ts`），导出 `getXxxExpertStaticPrompt()` 和 `buildXxxEditContext(currentContent)`，再在 segments 里调用，便于单测和迭代文案。

4. **单测**  
   - 对 `resolveScenario`：构造 `kind: 'tool'`, `toolMeta: { source: XXX_MANAGEMENT_SOURCE }` 的 session，断言得到 `'tool_xxx_management'`。  
   - 对 `buildPromptForScenario`：用该场景 + 对应 context，断言 `sessionStatic` 含身份/schema、不含每轮编辑内容，`perTurnDynamic` 含 `xxx_edit_context` 且内容来自 `ctx.xxxEditContext`。  
   - 可选：同一 context 调两次，断言 `sessionStatic` 完全一致（cache 不变性）。

5. **文档**  
   在 `recipe.ts` 或本目录的 README 里维护「场景 × sessionStatic 片段 × perTurn 片段」表，新增一行你的场景，便于后续再扩展类型时对照。

---

## 四、与工作流管理会话的对照

| 项目 | 工作流管理 | 你的新管理类型 |
|------|------------|----------------|
| source 常量 | `WORKFLOW_MANAGEMENT_SOURCE` | `XXX_MANAGEMENT_SOURCE` |
| 场景 ID | `tool_workflow_management` | `tool_xxx_management` |
| 身份片段 | `identity_workflow` | `identity_xxx` |
| 静态上下文 | `workflow_management_context` | `xxx_management_context` |
| 每轮编辑 | `workflow_edit_context` | `xxx_edit_context` |
| context 字段 | `workflowEditContext` | `xxxEditContext`（或复用/扩展） |
| 识别函数 | `isWorkflowManagementSession` | `isXxxManagementSession` |
| 工具 | create/update-workflow，无 navigate/workflow | 你定义的 submit/update 等，按需过滤 |

按上述清单逐项实现，即可在遵守现有约定、保持 cache 友好结构的前提下，高效完成新管理会话类型的提示词与工具集成。
