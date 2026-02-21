# Skill 模块全链路架构图

```mermaid
flowchart TB
  subgraph storage ["📦 数据存储"]
    FS[".prizm-data/skills/{name}/\nSKILL.md + scripts/ + references/ + assets/"]
    SESS["Session.allowedSkills\n会话级允许名单（白名单）"]
  end

  subgraph backend ["🔧 Server 核心 (prizm/src/)"]
    subgraph managers ["核心管理器"]
      SM["skillManager.ts\n─────────────────\nCRUD / loadAllSkillMetadata / loadSkillFull\ngetSkillFileTree() path+树\nlistSkillResources / readSkillResource\ngetSkillsToInject / getSkillsMetadataForDiscovery"]
      SR["skillRegistry.ts ★NEW\n─────────────────\nsearchRegistrySkills()\ngetFeaturedSkills()\nfetchSkillPreview()\ninstallSkillFromRegistry()\n─────────────────\nGitHub API + 内置精选\n缓存 5min TTL"]
    end

    subgraph routes ["REST API (routes/skills.ts)"]
      R_CRUD["CRUD 路由\nGET /skills（含 path）\nGET /skills/:name（含 path + fileTree）\nPATCH/DELETE /skills/:name\nGET /skills/:name/resources/*"]
      R_IMPORT["导入路由\nPOST /skills/import\nGET /skills/discover"]
      R_REG["注册表路由 ★NEW\nGET /skills/registry/search\nGET /skills/registry/featured\nGET /skills/registry/preview\nPOST /skills/registry/install"]
    end

    subgraph chat ["对话链路"]
      CC["chatCore.ts\n─────────────────\n渐进式/全量 skill 注入\n+ 技能路径自动合并入 session.grantedPaths"]
      DA["DefaultAgentAdapter\n.streamChat()\n传入 activeSkillInstructions"]
      SP["systemPrompt / promptPipeline\n─────────────────\n渐进式: &lt;available_skills&gt; name+description\n+ 工具 prizm_get_skill_instructions\n否则: &lt;skill name=…&gt;{instructions}&lt;/skill&gt;"]
    end

    subgraph slash ["Slash 命令"]
      SC["slashCommands.ts\n/skill 命令\n─────────────────\nlist / active / &lt;name&gt;\noff &lt;name&gt;\ninfo &lt;name&gt; ★NEW\nsearch &lt;query&gt; ★NEW"]
      SCR["slashCommandRegistry.ts\nSlashCommandDef 扩展:\n+ subCommands ★NEW\n+ argHints ★NEW"]
      META["routes/agent/metadata.ts\nGET /agent/slash-commands\nGET /agent/capabilities\n→ 包含 subCommands + argHints"]
    end
  end

  subgraph sdk ["📡 Client SDK (prizm-client-core)"]
    SDK_S["mixins/settings.ts\n─────────────────\nlistSkills()\ngetSkill() / createSkill()\nupdateSkill() / deleteSkill()\nimportSkills()\n─────────────────\nsearchSkillRegistry() ★NEW\ngetFeaturedSkills() ★NEW\npreviewRegistrySkill() ★NEW\ninstallRegistrySkill() ★NEW"]
    SDK_A["mixins/agent.ts\n─────────────────\ngetAgentSlashCommands()\n→ subCommands + argHints\ngetAgentCapabilities()\n─────────────────\n会话 allowedSkills\n(随 session 读写)"]
  end

  subgraph client ["🖥️ Electron Client (prizm-electron-client)"]
    subgraph settings_ui ["设置页面"]
      SS["SkillsSettings.tsx ★重写\n─────────────────"]
      TAB1["已安装 Tab\n卡片列表 / 展开 Markdown 预览\n编辑 / 删除 / 新建"]
      TAB2["浏览 Tab ★NEW\nGitHub 搜索 + 精选列表\n一键安装"]
      TAB3["导入 Tab\nClaude Code / 本地目录\nGitHub URL"]
    end

    subgraph chat_ui ["对话页面"]
      AB["ActionBar\n[Upload] [Think] [Tools] [Skills✨] [Clear]"]
      ST["SkillsToggle.tsx ★NEW\nSparkles 按钮 → Popover"]
      SMP["SkillManagerPanel.tsx ★NEW\n─────────────────\n允许: 每 skill/MCP 一个 Switch\n保存到 session.allowedSkills / allowedMcpServerIds"]
      MSO["MentionSlashOverlay.tsx ★重写\n两级自动补全\n─────────────────\n第一级: /skill → 展示命令\n第二级: /skill _ → 子命令+技能名"]
      ASH["agentStreamingHandlers.ts\n─────────────────\n(流式 chunk 处理)"]
    end
  end

  %% ===== 存储层连接 =====
  FS <-->|"读写 SKILL.md"| SM
  SESS -.->|"session 存 allowedSkills"| CC
  SR -->|"installSkillFromRegistry\n→ createSkill()"| SM

  %% ===== 路由连接管理器 =====
  R_CRUD --> SM
  R_IMPORT --> SM
  R_REG --> SR

  %% ===== 对话链路 =====
  CC -->|"activeSkillInstructions"| DA
  DA -->|"传入 skill 指令"| SP
  SM -->|"getSkillsToInject(scope,\nsession.allowedSkills)"| CC

  %% ===== Slash 命令 =====
  SC --> SM
  SC --- SCR
  SCR --> META

  %% ===== SDK 连接路由 =====
  SDK_S -->|"HTTP"| R_CRUD
  SDK_S -->|"HTTP"| R_IMPORT
  SDK_S -->|"HTTP"| R_REG
  SDK_A -->|"HTTP"| META

  %% ===== UI 连接 SDK =====
  SS --> TAB1 & TAB2 & TAB3
  TAB1 -->|"listSkills / createSkill\nupdateSkill / deleteSkill"| SDK_S
  TAB2 -->|"searchSkillRegistry\ninstallRegistrySkill"| SDK_S
  TAB3 -->|"importSkills"| SDK_S

  AB --> ST
  ST --> SMP
  SMP -->|"读写 session.allowedSkills\nallowedMcpServerIds"| SDK_A

  MSO -->|"getAgentSlashCommands\n→ subCommands + argHints"| SDK_A

  ASH -.->|"接收 SSE 流"| SDK_STREAM

  %% ===== 样式 =====
  classDef newNode fill:#e8f5e9,stroke:#4caf50,stroke-width:2px
  classDef rewriteNode fill:#fff3e0,stroke:#ff9800,stroke-width:2px
  classDef storageNode fill:#e3f2fd,stroke:#2196f3,stroke-width:2px

  class SR,R_REG,ST,SMP,TAB2,ASH newNode
  class SS,MSO,SC rewriteNode
  class FS,SESS storageNode
```

## 关键数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as Electron Client
    participant SDK as Client SDK
    participant API as REST API
    participant SM as skillManager
    participant SR as skillRegistry
    participant CC as chatCore
    participant LLM as LLM Provider

    Note over U,LLM: ① 从注册表安装 Skill
    U->>UI: 浏览 Tab → 搜索 "code review"
    UI->>SDK: searchSkillRegistry("code review")
    SDK->>API: GET /skills/registry/search?q=code+review
    API->>SR: searchRegistrySkills()
    SR->>SR: GitHub Code Search API (缓存 5min)
    SR-->>API: RegistrySearchResult
    API-->>SDK: { items, totalCount }
    SDK-->>UI: 展示搜索结果卡片
    U->>UI: 点击 "安装"
    UI->>SDK: installRegistrySkill(owner, repo, path)
    SDK->>API: POST /skills/registry/install
    API->>SR: installSkillFromRegistry()
    SR->>SR: fetchSkillPreview() → 下载 SKILL.md
    SR->>SM: createSkill(meta, body, 'github')
    SM->>SM: 写入 .prizm-data/skills/{name}/SKILL.md
    SR->>SR: downloadSkillResources() → scripts/references/assets
    SM-->>API: SkillConfig
    API-->>SDK: 201 Created
    SDK-->>UI: toast "已安装"

    Note over U,LLM: ② 对话中 Skill 注入（仅用 allowedSkills）
    U->>UI: 发送消息 "帮我 review 这段代码"
    UI->>SDK: streamChat(sessionId, content)
    SDK->>API: POST /agent/sessions/:id/chat (SSE)
    API->>CC: chatCore(options, onChunk, onReady)
    CC->>CC: 读取 session.allowedSkills
    CC->>SM: getSkillsToInject(scope, session.allowedSkills)
    SM->>SM: 若 allowedSkills 为空 → 全部已启用；否则只返回名单内
    SM-->>CC: [{ name, instructions }]
    CC->>LLM: buildSystemPrompt 含 <skill name="…">...</skill>
    LLM-->>CC: 流式回复
    CC-->>API: onChunk(text/tool_call/...)
    API-->>SDK: SSE data: { type: "text", ... }
    SDK-->>UI: 渲染助手回复

    Note over U,LLM: ③ 会话允许名单 (SkillManagerPanel)
    U->>UI: 点击 ActionBar ✨ → SkillManagerPanel
    UI->>SDK: getSession(sid) + listSkills() / listMcpServers()
    SDK->>API: GET /agent/sessions/:id + GET /skills 等
    API-->>SDK: session.allowedSkills / allowedMcpServerIds + 全部可用
    SDK-->>UI: 渲染面板（每项一个「允许」Switch）
    U->>UI: 勾选 "security-review" 允许 → 保存
    UI->>SDK: 更新 session (allowedSkills) / 保存 MCP 允许列表
    SDK->>API: PATCH /agent/sessions/:id 或对应保存接口
    API-->>SDK: 200 OK
    SDK-->>UI: 刷新面板

    Note over U,LLM: ④ Slash 命令 + 两级自动补全
    U->>UI: 输入 "/skill "
    UI->>UI: MentionSlashOverlay 检测二级触发
    UI->>UI: 展示 subCommands + argHints
    U->>UI: 选择 "info" → 补全为 "/(skill info) "
    U->>UI: 继续输入 skill 名 → 发送
    UI->>SDK: streamChat(sid, "/(skill info code-review)")
    SDK->>API: POST /agent/sessions/:id/chat
    API->>CC: tryRunSlashCommand("/skill", ["info","code-review"])
    CC->>SM: loadSkillFull("code-review")
    SM-->>CC: SkillFullContent
    CC-->>API: commandResult (详情文本)
    API-->>SDK: SSE { type: "command_result", value: "## code-review\n..." }
    SDK-->>UI: 渲染命令结果
```

## 技能路径、文件树与自动授权

- **path**：`SkillConfig` / `SkillFullContent` 均含 `path`（技能目录绝对路径）。GET `/skills`、GET `/skills/:name` 响应中均包含。
- **fileTree**：`getSkillFileTree(name)` 返回技能目录下树形结构（SKILL.md + scripts/references/assets 及嵌套）。GET `/skills/:name` 响应中增加 `fileTree` 字段；`prizm_get_skill_instructions` 工具结果中也会附带 path 与 fileTree 摘要，便于模型用 prizm_file 访问资源。
- **自动授权**：chatCore 在每次对话前，将当前会话允许的技能（`session.allowedSkills` 或全部已启用）对应的目录 path 合并入 `session.grantedPaths` 并持久化，使 prizm_file 等工具无需用户单独授权即可访问技能下 scripts/references/assets。

## 文件清单

| 类型 | 文件路径 | 状态 |
|------|----------|------|
| 核心管理器 | `prizm/src/llm/skillManager.ts` | 已有 |
| 注册表 | `prizm/src/llm/skillRegistry.ts` | **新建** |
| API 路由 | `prizm/src/routes/skills.ts` | 修改 |
| Slash 命令 | `prizm/src/llm/slashCommands.ts` | 修改 |
| 命令注册表 | `prizm/src/llm/slashCommandRegistry.ts` | 修改 |
| 系统提示 | `prizm/src/llm/systemPrompt.ts` | 已有 |
| 对话核心 | `prizm/src/routes/agent/chatCore/chatCore.ts` | 修改 |
| 对话核心类型 | `prizm/src/routes/agent/chatCore/types.ts` | 修改 |
| SSE 路由 | `prizm/src/routes/agent/chat.ts` | 修改 |
| 元数据路由 | `prizm/src/routes/agent/metadata.ts` | 修改 |
| SDK 设置 | `prizm-client-core/src/http/mixins/settings.ts` | 修改 |
| SDK 代理 | `prizm-client-core/src/http/mixins/agent.ts` | 修改 |
| 设置 UI | `prizm-electron-client/src/components/SkillsSettings.tsx` | **重写** |
| 对话面板 | `prizm-electron-client/src/components/agent/SkillManagerPanel.tsx` | **新建** |
| ActionBar 按钮 | `prizm-electron-client/src/features/ChatInput/ActionBar/SkillsToggle.tsx` | **新建** |
| ActionBar 配置 | `prizm-electron-client/src/features/ChatInput/ActionBar/config.ts` | 修改 |
| ActionBar 注册 | `prizm-electron-client/src/features/ChatInput/ActionBar/index.tsx` | 修改 |
| 自动补全 | `prizm-electron-client/src/features/ChatInput/MentionSlashOverlay.tsx` | **重写** |
| 输入状态类型 | `prizm-electron-client/src/features/ChatInput/store/initialState.ts` | 修改 |
| 流处理 | `prizm-electron-client/src/store/agentStreamingHandlers.ts` | 修改 |
| 页面配置 | `prizm-electron-client/src/views/AgentPage.tsx` | 修改 |
| 页面配置 | `prizm-electron-client/src/views/CollaborationPage.tsx` | 修改 |
| 页面配置 | `prizm-electron-client/src/components/collaboration/AgentPane.tsx` | 修改 |
