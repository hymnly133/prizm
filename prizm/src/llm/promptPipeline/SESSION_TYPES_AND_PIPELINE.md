# 当前所有 Session 类型与 promptPipeline 使用方式

本文档说明现有四种会话类型如何创建、如何流入 chatCore、以及 adapter 如何用 promptPipeline 产出提示词。

---

## 一、统一数据流（所有类型共用）

```
入口（SSE / BG Manager / ToolLLM）
    → chatCore(adapter, options, onChunk)
    → chatCore 内部：injectMemories → memorySystemTexts，load rules/skills，appendMessage(user)
    → adapter.chat(scope, sessionId, history, options)
    → DefaultAgentAdapter.chat 内：
        session = scopeStore.getScopeData(scope).agentSessions.find(...)
        scenario = resolveScenario(scope, sessionId, session)
        ctx = buildPromptContext({ scope, sessionId, session, ...options 映射 })
        { sessionStatic, perTurnDynamic } = await buildPromptForScenario(scenario, ctx)
        messages[0] = sessionStatic
        messages[n+1] 或 user 前缀 = perTurnDynamic + injectedPrefix
    → LLM
```

**chatCore 传给 adapter.chat 的 options**（与 pipeline 相关部分）：

- `includeScopeContext`、`rulesContent`、`customRulesContent`、`activeSkillInstructions`
- `grantedPaths`、`memoryTexts`、`systemPreamble`、`promptInjection`、`workflowEditContext`

**adapter 内 context 映射**：

- `callerPreamble` ← `options.systemPreamble`
- `workflowEditContext` ← `options.workflowEditContext`
- 其余与 options 同名传入 `buildPromptContext`。

---

## 二、四种 Session 类型一览

| 类型 | 场景 ID (PromptScenario) | session 形态 | 入口 | 传给 chatCore 的 pipeline 相关选项 |
|------|---------------------------|---------------|------|-------------------------------------|
| 用户交互聊天 | `interactive` | 无 `kind` 或 `kind` 非 background/tool | SSE `POST /agent/chat` | 无 systemPreamble/workflowEditContext；有 memoryTexts、promptInjection、rules、skills |
| 后台任务（含 cron/api） | `background_task` | `kind: 'background'`，`bgMeta.source` ≠ workflow | BackgroundSessionManager.triggerSync | systemPreamble=buildBgSystemPreamble；includeScopeContext=true；skipMemory 等按 memoryPolicy |
| 工作流 agent 步骤 | `background_workflow_step` | `kind: 'background'`，`bgMeta.source === 'workflow'` | WorkflowRunner → BgSessionStepExecutor → BackgroundSessionManager.triggerSync | 同上，meta 含 source:'workflow'、label、workspaceDir 等 |
| 工作流管理（Tool LLM） | `tool_workflow_management` | `kind: 'tool'`，`toolMeta.source === 'workflow-management'` | ToolLLMManager.start / resume | workflowEditContext=existingYaml；无 systemPreamble；includeScopeContext=false；skipMemory 等 |

---

## 三、各类型详细说明

### 1. 用户交互聊天（interactive）

- **创建**：用户在客户端选「新建会话」或直接发消息；服务端 `adapter.createSession(scope)`，不设 `kind`（或默认 interactive）。
- **session 形态**：`kind` 为 undefined 或 `'interactive'`，无 `toolMeta`/`bgMeta` 或为空。
- **入口**：`routes/agent/chat.ts` 的 SSE 处理，调用 `chatCore(adapter, { scope, sessionId, content, model, fileRefPaths, runRefIds, mcpEnabled, includeScopeContext, fullContextTurns, cachedContextTurns, actor, thinking }, onChunk)`。  
  **不传** `systemPreamble`、`workflowEditContext`。
- **chatCore 内部**：`injectMemories` → `memorySystemTexts`；`loadRules`/`loadActiveRules` → `rulesContent`/`customRulesContent`；`getSkillsToInject(scope, session.allowedSkills)` → `activeSkillInstructions`；slash 命令可能设置 `promptInjection`。这些通过 options 传给 adapter.chat。
- **resolveScenario**：session 无 kind 或非 background/tool → 返回 `'interactive'`。
- **配方**：sessionStatic = identity + instructions + rules + env + skills；perTurnDynamic = workspace_context + active_locks + memory_profile + prompt_injection。  
  **不** acceptCallerPreamble，无 workflow_edit_context。

---

### 2. 后台任务（background_task）

- **创建**：API/定时器等调用 `BackgroundSessionManager.trigger(scope, payload, meta)`；manager 内 `adapter.createSession` 后设 `kind: 'background'`、`bgMeta: { triggerType, source, workspaceDir, ... }`。  
  `source` 为 `'api'`、`'direct'`、或 cron 等，**不是** `'workflow'`。
- **session 形态**：`kind: 'background'`，`bgMeta.source` ∈ { api, direct, task, cron, … }。
- **入口**：`core/backgroundSession/manager.ts` 的 `executeRun`：`this.chatService.execute(this.adapter, { scope, sessionId, content: payload.prompt, model, signal, includeScopeContext: true, systemPreamble: buildBgSystemPreamble(payload, meta), skipCheckpoint: true, skipSummary/..., skipSlashCommands: true, skipChatStatus: true, actor: { type: 'system', source: 'bg-session' } }, chunkHandler)`。
- **chatCore**：收到 `systemPreamble`（即 callerPreamble），不跑 slash、不跑部分记忆/摘要逻辑（按 skip*）。  
  仍把 `rulesContent`/`customRulesContent`/`activeSkillInstructions` 等从 load 结果传入 adapter（若未 skip）。
- **resolveScenario**：`session.kind === 'background'` 且 `session.bgMeta?.source !== 'workflow'` → `'background_task'`。
- **配方**：sessionStatic = identity + instructions + rules + env + skills + **caller_preamble**；acceptCallerPreamble = true；perTurnDynamic = workspace_context + active_locks + memory_profile + prompt_injection。  
  caller_preamble 来自 options.systemPreamble（buildBgSystemPreamble 产出）。

---

### 3. 工作流 agent 步骤（background_workflow_step）

- **创建**：工作流执行到 agent 步骤时，`WorkflowRunner` 调用 `BgSessionStepExecutor.execute(scope, input, signal)`，其中 `input` 含 `label`、`workspaceDir`、`source: 'workflow'`、`sourceId`（runId）等；executor 调用 `BackgroundSessionManager.triggerSync(scope, payload, meta)`，`meta` 由 `buildMeta(input, sc)` 得到，包含 **source: input.source**（即 `'workflow'`）、label（如 `workflow:stepId`）、workspaceDir、persistentWorkspaceDir 等。
- **session 形态**：`kind: 'background'`，`bgMeta.source === 'workflow'`，`bgMeta.sourceId`、`bgMeta.label`、`bgMeta.workspaceDir` 等有值。
- **入口**：与「后台任务」相同，都是 `BackgroundSessionManager.executeRun` → chatCore；区别仅在于 **session 已在 create 时被写入的 bgMeta**（含 source=workflow）。  
  传入 chatCore 的 options 形态一致：`systemPreamble`、`includeScopeContext: true` 等。
- **resolveScenario**：`session.kind === 'background'` 且 `session.bgMeta?.source === 'workflow'` → `'background_workflow_step'`。
- **配方**：sessionStatic = identity + instructions + rules + env + **workflow_context** + skills + caller_preamble；acceptCallerPreamble = true；perTurnDynamic 同 background_task。  
  **workflow_context** 片段由 `session.bgMeta` 异步构建（run 信息、前序步骤结果、工作区规则等）。

---

### 4. 工作流管理会话（tool_workflow_management）

- **创建**：用户在「工作流」里点「用 AI 创建/编辑」等，客户端调 Tool LLM 相关 API；服务端 `ToolLLMManager.start(scope, request, onChunk)` 或复用已有 session。  
  start 时 `adapter.createSession` 后 `adapter.updateSession(scope, id, { kind: 'tool', toolMeta: { source: WORKFLOW_MANAGEMENT_SOURCE, label: '工作流管理: xxx' } })`。
- **session 形态**：`kind: 'tool'`，`toolMeta.source === 'workflow-management'`；可选 `toolMeta.workflowDefId`、`workflowName`、`persistentWorkspaceDir` 等。
- **入口**：`llm/toolLLM/manager.ts` 的 `executeRound`：`this.chatService.execute(this.adapter, { scope, sessionId, content, workflowEditContext: workflowEditContext ?? undefined, skipMemory: true, skipCheckpoint: true, ..., skipSlashCommands: true, mcpEnabled: true, includeScopeContext: false, actor: { type: 'system', source: 'tool-llm' } }, wrappedOnChunk)`。  
  **不传** systemPreamble；start 时传 `workflowEditContext: request.existingYaml`，resume 时传 `workflowEditContext: active?.latestYaml`。
- **chatCore**：收到 `workflowEditContext`，不注入记忆（skipMemory）、不 summary/checkpoint/slash 等；仍把 rules/skills 等通过 adapter 传入（若存在）。
- **resolveScenario**：`isWorkflowManagementSession(session)`（kind=tool 且 toolMeta.source=workflow-management，或兼容 legacy background）→ `'tool_workflow_management'`。
- **配方**：sessionStatic = **identity_workflow** + rules + env + **workflow_management_context** + skills；acceptCallerPreamble = false；perTurnDynamic = **workflow_edit_context** + active_locks。  
  无 identity/instructions、无 workspace_context/memory_profile/prompt_injection。  
  **workflow_edit_context** 从 `ctx.workflowEditContext` 读当前 YAML，写入 perTurn（cache 友好）。

---

## 四、场景解析与配方对照表

| 场景 | 判定条件 | sessionStatic 片段顺序 | acceptCallerPreamble | perTurnDynamic 片段 |
|------|----------|-------------------------|------------------------|----------------------|
| interactive | 无 session 或 kind 非 background/tool | identity, instructions, rules, env, skills | false | workspace_context, active_locks, memory_profile, prompt_injection |
| background_task | kind=background 且 bgMeta.source≠workflow | identity, instructions, rules, env, skills, caller_preamble | true | workspace_context, active_locks, memory_profile, prompt_injection |
| background_workflow_step | kind=background 且 bgMeta.source=workflow | identity, instructions, rules, env, workflow_context, skills, caller_preamble | true | 同上 |
| tool_workflow_management | isWorkflowManagementSession(session) | identity_workflow, rules, env, workflow_management_context, skills | false | workflow_edit_context, active_locks |

---

## 五、工具集与 pipeline 的关系

- **promptPipeline** 只负责产出 **sessionStatic** 和 **perTurnDynamic** 文本，不决定工具列表。
- 工具列表在 **DefaultAgentAdapter.chat** 中：先 `getBuiltinTools()`，再按 `getToolGroupConfig()` + `session.bgMeta?.toolGroups` 过滤，再按 session 类型：
  - `prizm_set_result`：仅 `session.kind === 'background'` 保留；
  - `filterWorkflowBuilderForSession`：工作流管理会话仅去掉 `prizm_navigate`，保留 `prizm_workflow` 等通用工作流能力；并保留 workflow-management-create/update-workflow 工具。
- 因此「工作流管理」的提示词（identity_workflow、workflow_management_context、workflow_edit_context）与「工具集」是分开配置的：前者由 pipeline 配方决定，后者由 adapter 内对 session 的判断决定。

---

## 六、小结

- **所有** 会话的 LLM 请求都经过同一条路径：**chatCore → adapter.chat → resolveScenario → buildPromptContext → buildPromptForScenario**，再组 messages。
- **区分** 只依赖 **session 的 kind / bgMeta.source / toolMeta.source**，从而得到四种场景之一和对应配方。
- **交互** 与 **后台/工作流步骤** 的差异：后者由 BackgroundSessionManager 传入 `systemPreamble`（callerPreamble），配方中 acceptCallerPreamble=true 并拼入 sessionStatic。
- **工作流管理** 的差异：不传 systemPreamble，传 `workflowEditContext`；使用 identity_workflow + workflow_management_context，当前 YAML 仅放在 perTurn 的 workflow_edit_context（cache 友好）。
