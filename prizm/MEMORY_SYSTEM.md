# Prizm 记忆系统

基于 `@prizm/evermemos`（EverMemOS 的本地实现）构建的三层记忆架构，为 Agent 对话提供持久化的上下文记忆能力。

## 架构总览

```
                        ┌─────────────────────────────────────────┐
                        │             EverMemService              │
                        │  (prizm/src/llm/EverMemService.ts)      │
                        │                                         │
                        │  addMemoryInteraction()  ── 写入记忆     │
                        │  addDocumentToMemory()   ── 文档记忆     │
                        │  searchThreeLevelMemories() ── 三层检索  │
                        │  deleteMemoriesByGroupId()  ── 生命周期  │
                        └──────────┬──────────────────┬───────────┘
                                   │                  │
                    ┌──────────────▼──┐    ┌──────────▼──────────┐
                    │  MemoryManager  │    │  RetrievalManager   │
                    │  (写入 + 路由)   │    │  (检索 + 融合)       │
                    └──────┬──────────┘    └──────────┬──────────┘
                           │                          │
              ┌────────────┼────────────┐    ┌───────┼────────┐
              │            │            │    │       │        │
        ┌─────▼──┐  ┌──────▼──┐  ┌─────▼─┐ │  Keyword  Vector│
        │Profile │  │Episodic │  │Event  │ │  Search   Search│
        │Extract │  │Extract  │  │Log    │ │       │        │
        │        │  │         │  │Extract│ │   Hybrid/RRF    │
        └────────┘  └─────────┘  └───────┘ │    Agentic     │
                                           │    Rerank      │
                    ┌──────────────────┐   └────────────────┘
                    │  Foresight       │
                    │  Extractor       │
                    └──────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        ┌─────▼──────┐          ┌───────▼──────┐
        │  SQLite    │          │  LanceDB     │
        │  (关系存储) │          │  (向量存储)   │
        └────────────┘          └──────────────┘
```

## 三层记忆模型

记忆按生命周期和粒度分为三个层级，通过 `user_id` + `group_id` 的命名约定实现逻辑隔离，无需修改底层存储结构。

### User 层 -- 跨 Scope 持久

| 字段 | 值 |
|------|----|
| `user_id` | `clientId`（真实用户标识） |
| `group_id` | `null` |
| 记忆类型 | Profile |
| 写入时机 | 每次对话后抽取 |
| 用途 | 用户画像、偏好、身份、技能、习惯 |

Profile 记忆跨所有 scope 共享，描述用户本身的长期属性。

### Scope 层 -- 随 Scope 管理

| 字段 | 值 |
|------|----|
| `user_id` | `clientId` |
| `group_id` | `scope`（如 `"online"`） |
| 记忆类型 | Episodic, Foresight |
| 写入时机 | 每次对话后抽取 |
| 用途 | "上周聊了什么"、"接下来要做什么" |

**Scope:Document 子层**

| 字段 | 值 |
|------|----|
| `user_id` | `clientId` |
| `group_id` | `scope + ":docs"`（如 `"online:docs"`） |
| 记忆类型 | Episodic, EventLog |
| 写入时机 | 文档创建/更新触发摘要时 |
| 用途 | "文档里提到的 xxx" |

### Session 层 -- 随会话管理

| 字段 | 值 |
|------|----|
| `user_id` | `clientId` |
| `group_id` | `scope + ":session:" + sessionId` |
| 记忆类型 | EventLog |
| 写入时机 | 每次对话中实时抽取 |
| 用途 | 本次对话内的精确事实回忆 |

Session 记忆在会话删除时自动清除。

## 记忆类型

### Profile (用户画像)

由 `ProfileMemoryExtractor` 从对话中抽取。包含用户名、硬/软技能、决策方式、性格、兴趣、工作偏好等结构化属性。**写入 User 层**，跨 scope 持久。

### Episodic (叙事摘要)

由 `EpisodeExtractor` 生成。将对话内容压缩为叙事性摘要，保留关键上下文。**写入 Scope 层**（对话场景）或 **Scope:Document 层**（文档场景）。

### Foresight (未来意图)

由 `ForesightExtractor` 抽取。识别用户的计划、意图、目标等前瞻性信息。**仅在 assistant 场景**写入 **Scope 层**。

### EventLog (原子事实)

由 `EventLogExtractor` 抽取。每条原子事实独立一条记录，精确可查。**写入 Session 层**（对话场景）或 **Scope:Document 层**（文档场景）。

## 场景 (Scene)

`MemCell.scene` 表示记忆来源的场景，决定会抽取哪些类型的记忆。

### 三种场景含义

| Scene | 含义 | 典型来源 |
|-------|------|----------|
| **assistant** | 用户与 AI 的 1:1 对话 | Agent 会话中用户发一条、助手回一条的对话流；当前 Prizm 的 Agent 聊天即为此场景 |
| **group** | 群聊 / 多参与方对话 | 多人或群组内的对话；此类场景下**不抽取**任何记忆，避免把群聊内容当作个人记忆 |
| **document** | 文档内容作为记忆源 | 将 scope 内某篇文档的正文录入为记忆（如 `addDocumentToMemory`）；只做叙事摘要和原子事实，不抽用户画像或未来意图 |

### 各场景下的抽取行为

`MemCell.scene` 控制不同场景下是否抽取各类记忆：

| Scene | Profile | Episodic | Foresight | EventLog |
|-------|---------|----------|-----------|----------|
| `assistant` | Y | Y | Y | Y |
| `group` | -- | -- | -- | -- |
| `document` | -- | Y | -- | Y |

## 写入流程

### 对话记忆

```
用户发送消息 → LLM 响应完成
    ↓
agent.ts: addMemoryInteraction(messages, userId, scope, sessionId)
    ↓
EverMemService: 构造 MemCell(CONVERSATION, scene='assistant')
    ↓
MemoryManager.processMemCell(memcell, routing)
    ↓
并行触发四个 Extractor:
    ProfileExtractor    → group_id = null          (User 层)
    EpisodeExtractor    → group_id = scope         (Scope 层)
    ForesightExtractor  → group_id = scope         (Scope 层)
    EventLogExtractor   → group_id = scope:session:sid (Session 层)
    ↓
各 Extractor 调 LLM 生成结构化记忆 → 写入 SQLite + LanceDB
```

### 文档记忆

```
文档创建/更新 → documentSummaryService 生成摘要
    ↓
addDocumentToMemory(userId, scope, documentId)
    ↓
EverMemService: 读取文档内容 → 构造 MemCell(TEXT, scene='document')
    ↓
MemoryManager.processMemCell(memcell, routing)
    ↓
触发:
    EpisodeExtractor → group_id = scope:docs  (Scope:Document 层)
    EventLogExtractor → group_id = scope:docs (Scope:Document 层)
```

## 检索流程

### 对话中的三层并行检索

当用户发送消息时，`agent.ts` 并行执行三层检索：

```
用户消息到达
    ↓
searchThreeLevelMemories(query, userId, scope, sessionId)
    ↓
并行:
    searchUserMemories()   → user_id=userId, group_id=null, types=[Profile]
    searchScopeMemories()  → user_id=userId, group_id=scope, types=[Episodic, Foresight]
                           + user_id=userId, group_id=scope:docs, types=[Episodic, EventLog]
    searchSessionMemories()→ user_id=userId, group_id=scope:session:sid, types=[EventLog]
    ↓
组装三段上下文注入 LLM:
    [User Memory]    -- 用户偏好、身份
    [Scope Memory]   -- 历史对话摘要、计划、文档知识
    [Session Memory] -- 本次对话的精确事实
```

### 检索方法

| 方法 | 说明 | 适用场景 |
|------|------|----------|
| `KEYWORD` | 基于结巴分词的关键词匹配 | 精确名词/术语查询 |
| `VECTOR` | 基于 embedding 的语义搜索 | 语义相似性查询 |
| `HYBRID` | Keyword + Vector 的 RRF 融合（默认） | 通用场景 |
| `AGENTIC` | LLM 查询扩展 + 多路 Hybrid + N-way RRF | 复杂多意图查询 |
| `use_rerank` | 检索后 LLM 精排 | 需要高相关度时显式开启 |

默认使用 `HYBRID`。`AGENTIC` 和 `use_rerank` 会产生额外 LLM 调用，仅在需要时使用。

## 生命周期管理

| 事件 | 操作 |
|------|------|
| Session 删除 | `deleteMemoriesByGroupId(scope:session:sessionId)` -- 清除该 session 的 EventLog |
| Scope 删除 | `deleteMemoriesByGroupPrefix(scope)` -- 清除该 scope 下所有层级记忆（预留） |
| 单条删除 | `deleteMemory(id)` -- 通过 HTTP API / MCP 删除指定记忆 |

## 对外接口

### HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/agent/memories` | 列出当前用户所有记忆 |
| `POST` | `/agent/memories/search` | 搜索记忆，支持 `method`/`use_rerank`/`limit`/`memory_types` |
| `DELETE` | `/agent/memories/:id` | 删除单条记忆 |

### 内置工具 (Agent)

| 工具名 | 说明 |
|--------|------|
| `prizm_list_memories` | 列出记忆条目 |
| `prizm_search_memories` | 按关键词/语义搜索记忆 |

### MCP Server

| 工具名 | 说明 |
|--------|------|
| `prizm_list_memories` | 列出记忆（JSON 格式输出） |
| `prizm_search_memories` | 搜索记忆（JSON 格式输出，含 score） |

## 存储

| 存储 | 路径 | 用途 |
|------|------|------|
| SQLite | `{dataDir}/evermemos.db` | 关系型存储：记忆元数据、内容、user_id、group_id |
| LanceDB | `{dataDir}/evermemos_vec/` | 向量存储：embedding 向量，支持语义搜索 |

`dataDir` 默认为 `.prizm-data`，可通过 `PRIZM_DATA_DIR` 环境变量配置。

## LLM 依赖

记忆系统依赖 LLM 完成以下任务：

- **抽取**：四个 Extractor 各自调用 LLM 从对话/文档中抽取结构化记忆
- **Embedding**：生成向量用于语义搜索
- **查询扩展**（Agentic 模式）：将用户查询扩展为多条子查询
- **Rerank**（可选）：对检索结果进行 LLM 精排

所有 LLM 调用通过 `PrizmLLMAdapter` 适配，Token 用量记录到用户的 `memory` 功能 scope。

## 关键文件

```
packages/evermemos/
├── src/types.ts                     # 核心类型：MemCell, MemoryType, MemoryRoutingContext
├── src/core/MemoryManager.ts        # 写入管理：processMemCell, 三层路由, 生命周期删除
├── src/core/RetrievalManager.ts     # 检索管理：Keyword/Vector/Hybrid/Agentic/Rerank
├── src/extractors/
│   ├── EpisodeExtractor.ts          # 叙事摘要抽取
│   ├── EventLogExtractor.ts         # 原子事实抽取
│   ├── ForesightExtractor.ts        # 未来意图抽取
│   └── ProfileMemoryExtractor.ts    # 用户画像抽取
├── src/storage/
│   ├── sqlite.ts                    # SQLite 适配器
│   └── lancedb.ts                   # LanceDB 向量适配器
└── src/utils/
    ├── rankFusion.ts                # RRF 融合算法
    └── queryExpansion.ts            # 查询扩展（Agentic 用）

prizm/src/
├── llm/EverMemService.ts           # 服务层：初始化、三层写入/检索、生命周期
├── llm/documentSummaryService.ts   # 文档摘要后触发文档记忆写入
├── llm/builtinTools.ts             # Agent 内置工具：list/search memories
├── routes/agent.ts                 # 对话流程：三层检索注入 + 记忆存储
├── routes/memory.ts                # HTTP API：列出/搜索/删除记忆
└── mcp/index.ts                    # MCP 工具：list/search memories
```
