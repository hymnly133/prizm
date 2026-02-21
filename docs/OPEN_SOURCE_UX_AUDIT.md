# Prizm 开源发布 — 用户体验审计报告

本报告从「快速上手、使用方式、配置方案、晦涩配置、项目特点可见性」五个维度对当前文档与配置进行审计，便于正式开源前改进。

---

## 0. 怎么快速上手

### 现状

- **根 README** 已有「快速开始」：安装依赖 → 启动服务端 → 可选启动 Electron。
- 步骤清晰：`yarn install` → `yarn dev:server`（或 build + start）→ 访问 `http://127.0.0.1:4127/dashboard/`。
- **缺口**：
  - 没有「60 秒体验」式的一键路径（例如：不配置任何 key 能否看到界面、健康检查是否通过）。
  - 首次运行若未配置 LLM，Agent 能力会提示需要配置，但 README 未明确写「不配置也能先看面板和 API」。
  - `.env` 放置位置存在歧义：根 README 写「复制 `prizm/.env.example` 为 `prizm/.env`」，而 prizm/README 写「项目根或 prizm/.env 均可」—— 新用户可能不知道优先用哪个。
  - 未强调「仅用服务端 + 浏览器访问 /dashboard/ 即可完成第一次体验」，Electron 标为可选但未说明「仅服务端也能用」。

### 建议

- 在根 README 最前增加 **「一分钟体验」** 小节：  
  `git clone → yarn install → yarn dev:server`，浏览器打开 `/dashboard/`，无需任何 .env 即可看到面板；Agent 需至少一个 LLM Key。
- 明确 **.env 推荐位置**：推荐 `prizm/.env`（与 .env.example 同目录），并注明「若根目录存在 .env，部分工具也会加载」避免混淆。
- 可选：增加「首次运行检查清单」（端口 4127 可用、Node 版本、若 4127 被占用可 `yarn kill-port` 或改 `PRIZM_PORT`）。

---

## 1. 怎么使用

### 现状

- **服务端**：根 README 与 prizm/README 覆盖了启动方式、API 概览、健康检查、便签/通知/Agent 的 curl 示例。
- **Electron 客户端**：根 README 只写「可选：yarn dev:electron」，未说明启动后要填服务端地址、是否默认连 127.0.0.1:4127、首次使用流程（例如注册 API Key 的入口在哪）。
- **MCP**：MCP-CONFIG.md 非常完整（Cursor stdio、LobeChat HTTP、Scope、工具一览、故障排查），但根 README 仅链接过去，未概括「用 Cursor 时改哪几个配置项」。
- **工作流 / 本地 Embedding**：docs/workflow-system.md、docs/local-embedding.md 内容充足，但根 README 只列在「文档」里，未在「怎么用」里区分「普通用户 vs 进阶能力」。

### 建议

- 根 README 的「快速开始」下增加 **「使用方式概览」**：
  - 仅服务端：浏览器访问 `/dashboard/`，或调用 HTTP API（含 curl 示例链接）。
  - 桌面端：`yarn dev:electron`，默认连接本机 4127，首次使用说明「在客户端内或 Dashboard 注册 API Key」。
  - 与 Cursor/LobeChat 集成：见 MCP-CONFIG.md，一句话概括「Cursor 配 stdio-bridge 路径与 PRIZM_URL / API_KEY」。
- 在「文档」小节保留现有链接，并增加简短说明：工作流 = 多步自动化流水线；本地 Embedding = 默认启用的向量模型，用于记忆与检索。
- 可选：在 prizm/README 或根 README 增加「常见使用场景」：仅 API、仅面板、面板 + Electron、面板 + MCP（Cursor）、全链路（面板 + Electron + MCP）。

---

## 2. 是否有更好的配置方案

### 现状

- **环境变量**：根 README 与 prizm/.env.example、CLAUDE.md 三者一致性好；.env.example 注释清晰，按「服务 / 鉴权 / Agent / Embedding / 搜索 / Skills」分组。
- **配置入口分散**：
  - 服务：环境变量（.env 或 shell）。
  - Agent 上下文压缩：环境变量 + 服务端 `agent-tools.json` + 请求体覆盖（CONTEXT_COMPRESSION.md），对普通用户略复杂。
  - MCP：Cursor 的 mcp.json、LobeChat 的 MCP 配置、服务端 PRIZM_MCP_SCOPE 等，已在 MCP-CONFIG 中说明，但「推荐默认」不突出。
  - 工作流、Skills、Agent Rules：部分在 Electron 设置页，部分在 API/文件（如 .prizm/rules/），文档有写但未在「配置」主题下汇总。

### 建议

- **保持 .env.example 为唯一环境变量清单**，在 README 中明确「所有服务端相关环境变量以此为准」，避免在 README 再列一版易过期列表；README 只保留最常用 5–8 个（PORT、HOST、DATA_DIR、AUTH_DISABLED、三大 LLM_KEY）。
- **增加「配置总览」文档**（或 README 小节）：  
  一张表：配置项 / 作用 / 配置方式（环境变量 / Dashboard / 客户端设置 / 文件路径），便于用户判断「改什么、去哪改」。
- **Agent 上下文压缩**：在 CONTEXT_COMPRESSION.md 开头加一句「大多数用户使用默认 A/B 即可，仅需调优时再改环境变量或 agent-tools.json」。

---

## 3. 是否有晦涩难懂的配置

### 现状

- **相对易懂**：PRIZM_PORT、PRIZM_HOST、PRIZM_DATA_DIR、PRIZM_AUTH_DISABLED、XIAOMIMIMO_API_KEY、ZHIPU_API_KEY、OPENAI_API_KEY、TAVILY_API_KEY、PRIZM_SKILLKIT_API_URL、GITHUB_TOKEN。
- **需要解释的**：
  - **PRIZM_DATA_DIR**：写「数据目录」不够，新用户不知道会在这里存 scope 数据、会话、锁、审计库等；建议注明「所有持久化数据（便签、待办、文档、Agent 会话、锁、审计等）的根目录」。
  - **PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS**：名字长且含义不直观，建议注释写「单次请求注入到 Agent 的 scope 上下文（便签/待办/文档摘要）最大字符数」。
  - **PRIZM_EMBEDDING_***：local-embedding.md 已说明，.env.example 有注释；若 README 只列变量名，建议链接到 docs/local-embedding.md。
  - **PRIZM_FULL_CONTEXT_TURNS / PRIZM_CACHED_CONTEXT_TURNS**：仅在 CONTEXT_COMPRESSION.md 出现，.env.example 未列；对想调「上下文轮数」的用户不友好。建议在 .env.example 中增加可选注释块，并注明「详见 CONTEXT_COMPRESSION.md」。
  - **Scope（default / online）**：MCP-CONFIG 和 README 有提，但「default 与 online 的区别、何时用哪个」可再写一句：例如「default = 通用；online = 与 Electron 常驻展示一致，推荐 MCP/Agent 默认用 online」。
  - **X-Prizm-Scope / X-Prizm-Panel**：在鉴权与 API 文档中有写，但「Header 命名由来」不必展开，只需在 API 小节明确「请求时用 X-Prizm-Scope 指定数据空间」即可。

### 建议

- 在 **prizm/.env.example** 中：
  - 为 PRIZM_DATA_DIR、PRIZM_AGENT_SCOPE_CONTEXT_MAX_CHARS 补一行简短注释。
  - 增加可选块：`# 上下文压缩（详见 CONTEXT_COMPRESSION.md）` 与 `PRIZM_FULL_CONTEXT_TURNS`、`PRIZM_CACHED_CONTEXT_TURNS`。
- 在 **README 或配置总览** 中：对「Scope」用一两句话说明 default vs online 的推荐用法。
- **术语表**（可选）：在 docs 或 README 末尾增加「Scope / MCP / Agent / 工作流 / Embedding」一句话解释，便于从其他项目迁移来的用户对照。

---

## 4. 是否能快速浏览到项目特点

### 现状

- **根 README** 第一段已概括：桌面效率工具、HTTP API、WebSocket、便签/待办/番茄钟/剪贴板/文档/通知、MCP 与 Cursor/LobeChat。
- **核心能力表** 列了便签、待办、番茄钟、剪贴板、文档、通知、Agent、MCP，但缺少「差异化」提炼。
- **未突出**：工作流（多步自动化 + 审批）、本地 Embedding（免云、隐私）、Agent 与 MCP 打通本机数据、Scope 多工作区、资源锁与审计等「技术亮点」；这些在 CLAUDE.md 和专项文档里有，但普通访客不会先看 CLAUDE。

### 建议

- 在根 README 开头（首段或紧接着）增加 **「特点一览」**（3–5 条 bullets）：
  - 本机优先：数据可完全落在本地（.prizm-data），可选本地 Embedding。
  - 与 AI 工作流打通：MCP 暴露便签/待办/文档/剪贴板给 Cursor、LobeChat；内置 Agent 对话与工作流编排。
  - 多工作区（Scope）：default / online 等，数据隔离，适合多项目或多设备语义。
  - 生产向能力：资源锁、审计日志、WebSocket 实时推送、可嵌入现有应用（适配器模式）。
- **核心能力表** 保留，在表前加一句：「除下表外，还支持工作流编排、本地向量检索（Embedding）、Agent 审批与 MCP 扩展。」
- 若希望吸引「集成方」：在 README 或 docs 中保留一句「可仅用 HTTP API + 自建前端，或嵌入现有 Electron/Node 应用（见适配器接口）」。

---

## 总结与优先级

| 维度           | 现状评分 | 主要动作 |
|----------------|----------|----------|
| 快速上手       | 良好     | 增加「一分钟体验」、统一 .env 位置说明、可选检查清单 |
| 怎么使用       | 良好     | 使用方式概览（仅服务端 / 桌面端 / MCP）、场景化说明 |
| 配置方案       | 良好     | 配置总览表、.env.example 为权威清单、压缩参数可发现 |
| 晦涩配置       | 可改进   | .env.example 与 README 补注释、Scope 推荐用法、可选术语表 |
| 项目特点可见性 | 可改进   | 首屏「特点一览」、核心能力表前一句概括、工作流/Embedding 露出 |

建议优先做：  
1）根 README 的「一分钟体验」与「特点一览」；  
2）统一并补全 .env 与 Scope 的说明；  
3）增加「使用方式概览」与「配置总览」小节（可在 README 或单独 docs）。  

完成以上后，新访客能在 1 分钟内知道「这是什么、怎么跑起来、要改哪些配置、哪里看细节」，更符合开源项目首次发布的体验预期。
