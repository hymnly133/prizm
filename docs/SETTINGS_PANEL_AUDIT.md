# 客户端设置面板审计报告

对 Electron 客户端设置页（SettingsPage）的结构、分类与交互进行审计，重点：**不要单一「服务端配置」大杂烩**、**LLM 配置需有明确提交按钮**。

---

## 1. 当前结构概览

| 侧栏分类 | 组件 | 内容摘要 |
|----------|------|----------|
| 连接 | SettingsPage 内联 | 服务器地址、端口、客户端名称、Scopes、通知事件 |
| 外观 | 内联 | 主题模式、主题色、中性色 |
| 输入 | 内联 | 发送快捷键（回车 / Ctrl+Enter） |
| 工作区 | ScopeManagement | Scope 列表与管理 |
| **服务端配置** | **ServerConfigSettings** | **端口、监听地址、数据目录、鉴权、日志、MCP Scope、Embedding、Agent 上下文、LLM 配置、SkillKit/GitHub Token**（混合一大块） |
| Agent | AgentGeneralSettings | 默认模型、摘要、上下文窗口、记忆、终端（来自 agent tools API） |
| 模型 | EmbeddingStatus | Embedding 状态、测试、基准（只读/调试，无配置表单） |
| 技能与 MCP | SkillsAndMcpSettings | 技能 Tab + MCP Tab |
| 命令 | CommandsSettings | 自定义命令 |
| 规则 | AgentRulesSettings | Agent 规则 |
| 快捷操作 | 内联 | 重新连接、打开仪表板 |

---

## 2. 发现的问题

### 2.1 存在「服务端配置」大杂烩（需拆分）

**现象**：侧栏「服务端配置」一项内包含多种不同性质的配置，混在同一页：

- **服务与网络**：端口、监听地址、数据目录（仅读）—— 纯服务端运维
- **鉴权与日志**：关闭鉴权、日志级别、MCP 默认 Scope —— 服务端运维
- **Embedding**：启用、模型、缓存目录、量化、并发 —— 应归属「模型」类
- **Agent 上下文**：Scope 上下文最大字符数 —— 应归属「Agent」类
- **LLM 配置**：多配置、API Key、默认配置 —— 应独立为「LLM 配置」且需单独提交
- **技能与搜索**：SkillKit API 地址、GitHub Token —— 应归属「技能与 MCP」类

**影响**：用户心智负担大，不知道「改 LLM」要去「服务端配置」里找；且与侧栏已有的「Agent」「模型」「技能与 MCP」重复/割裂。

**建议**：按「谁用、改什么」拆分到对应分类，不再保留单一「服务端配置」大块。

---

### 2.2 LLM 配置没有单独提交按钮

**现象**：`ServerConfigSettings` 中 LLM 配置（多配置、API Key、默认配置）仅随整页底部的「保存服务端配置」一起保存，LLM 区块本身没有「保存」或「提交」按钮。

**影响**：用户改完 LLM 后容易只看到一屏表单项，不知道需要拉到页面最底部点「保存服务端配置」；且若只想改 LLM，也会被引导去改端口/鉴权等无关项。

**建议**：

- 将 **LLM 配置** 拆成独立设置分类（侧栏「LLM 配置」或「LLM」），单独页面/组件。
- 在该页面内提供明确的 **「保存 LLM 配置」** 按钮，仅提交 `PATCH /settings/server-config` 的 `llm` 部分。

---

### 2.3 其他一致性问题

- **Agent 页**：未包含「Scope 上下文最大字符数」，该配置仍在「服务端配置」中，与「Agent」语义不一致。
- **模型页**：仅有 Embedding 状态/测试/基准，没有「Embedding 运行配置」（启用、模型、缓存目录等）的可编辑表单，用户需到「服务端配置」里改。
- **技能与 MCP 页**：SkillKit API、GitHub Token 在「服务端配置」中，与「技能」入口分离。

---

## 3. 建议的拆分与归属

| 配置项 | 当前位置 | 建议位置 | 说明 |
|--------|----------|----------|------|
| 端口、监听地址、数据目录（只读） | 服务端配置 | **服务端/运维**（保留一项精简页） | 仅服务与网络 |
| 鉴权、日志级别、MCP 默认 Scope | 服务端配置 | **服务端/运维** | 同上 |
| Embedding：启用、模型、缓存、量化、并发 | 服务端配置 | **模型**（Embedding 配置卡片） | 与 Embedding 状态同页 |
| Scope 上下文最大字符数 | 服务端配置 | **Agent** | 与默认模型、摘要等一起 |
| LLM：多配置、API Key、默认配置 | 服务端配置 | **LLM 配置**（独立分类 + 单独保存按钮） | 独立入口、单独提交 |
| SkillKit API、GitHub Token | 服务端配置 | **技能与 MCP**（顶部配置区） | 与技能/MCP 同页 |

---

## 4. 实施要点

1. **侧栏**：新增「LLM 配置」；将「服务端配置」改名为「服务端/运维」并仅保留「服务与网络」「鉴权与日志」两块。
2. **LLM 配置页**：新组件（如 `LLMConfigSettings`），仅拉取/提交 `server-config` 的 `llm` 字段，页面内显眼处提供「保存 LLM 配置」按钮。
3. **模型页**：在 `EmbeddingStatus` 中增加「Embedding 配置」卡片（或同页上方），表单字段与当前 ServerConfig 的 embedding 一致，提供「保存 Embedding 配置」按钮。
4. **Agent 页**：在 `AgentGeneralSettings` 中增加「Scope 上下文最大字符数」表单项，加载/保存使用 `getServerConfig` / `updateServerConfig` 的 `agent` 部分；可与现有「保存 Agent 设置」合并为一次保存（同时提交 agent tools + server config agent）。
5. **技能与 MCP 页**：在 `SkillsAndMcpSettings` 顶部（Tab 上方或技能 Tab 内顶部）增加「技能与搜索配置」卡片：SkillKit API 地址、GitHub Token，使用 `getServerConfig` / `updateServerConfig` 的 `skills` 部分，并提供「保存」按钮。
6. **服务端/运维页**：`ServerConfigSettings` 精简为仅「服务与网络」「鉴权与日志」，底部保留「保存服务端配置」。

---

## 5. API 与兼容性

- `PATCH /settings/server-config` 已支持部分更新（`Partial<ServerConfig>`），可仅传 `llm`、`embedding`、`agent`、`skills` 等子集，无需改服务端。
- 客户端 `updateServerConfig(patch)` 已按 patch 合并，拆分后各页面只传各自关心的字段即可。

---

## 6. 小结

| 检查项 | 结论 |
|--------|------|
| 是否存在单一「服务端配置」大杂烩 | ❌ 存在，需按上表拆分到 LLM、模型、Agent、技能与 MCP、服务端/运维 |
| LLM 配置是否有单独提交按钮 | ❌ 无，需独立「LLM 配置」入口并在该页提供「保存 LLM 配置」 |
| Agent 相关是否集中 | ⚠️ 缺「Scope 上下文最大字符数」，应并入 Agent 页 |
| 模型页是否可编辑 Embedding 配置 | ❌ 仅状态/测试，需增加配置表单与保存 |
| 技能相关是否集中 | ⚠️ SkillKit/GitHub 在服务端配置，应移至技能与 MCP 页 |

实施完成后，设置面板将按「连接、外观、输入、工作区、服务端/运维、LLM 配置、Agent、模型、技能与 MCP、命令、规则、快捷操作」划分，无大杂烩，且 LLM 配置具备明确提交按钮。
