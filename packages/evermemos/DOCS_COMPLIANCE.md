# 与 EverMemOS 文档的对照与实现说明

本包为 EverMemOS 的 TypeScript 迁移，设计上参照仓库内 `EverMemOS/docs`。以下说明实现与文档的对应关系及差异。

## 参照文档（EverMemOS/docs）

- **ARCHITECTURE.md** - 分层与数据流
- **dev_docs/memory_types_guide.md** - MemCell / Episode / Foresight / EventLog / Profile
- **advanced/RETRIEVAL_STRATEGIES.md** - keyword / vector / RRF / agentic
- **api_docs/memory_api.md** - 检索参数与语义

---

## 已对齐的部分

### 1. 记忆类型与构造流程

- **MemCell**：以 `original_data`（对话列表）+ `timestamp` + `user_id` 等传入 `processMemCell`，与文档中「边界检测后的记忆单元」语义一致；未实现边界检测，由调用方按轮次/会话提交。
- **Episode**：`EpisodeExtractor` 从 MemCell 抽取叙事摘要（title/content/summary/keywords），写入 `episodic_memory`，与文档 Episode 一致。
- **Foresight**：`ForesightExtractor` 抽取预测性记忆（content/evidence/start_time/end_time 等），与文档 Foresight 字段一致。
- **EventLog**：`EventLogExtractor` 从 LLM 返回的 `event_log.atomic_fact` 抽取原子事实；**每个 atomic_fact 单独一条记录**（单独 `content`、单独 `embedding`，`metadata` 含 `time`、`parent_type`、`parent_id`），与文档粒度一致。
- **Profile**：`ProfileMemoryExtractor` 多部分抽取用户画像（hard_skills/soft_skills/personality 等），与文档 Profile 一致。
- **提取顺序**：与文档一致，按 Episode → Foresight → EventLog → Profile 并行触发。

### 2. 检索策略

- **KEYWORD**：关键词检索。文档为 BM25/Elasticsearch；本实现用 SQLite `content LIKE ?` + 分词（jieba），并**按 `user_id` / `group_id` 过滤**，与 API 文档「至少提供 user_id 或 group_id」的语义一致。
- **VECTOR**：向量检索。文档为 Milvus；本实现为 LanceDB，按 `memory_types` 检索，并对结果按 **`user_id` / `group_id` 过滤**。
- **HYBRID / RRF**：并行执行 keyword + vector，再用 **Reciprocal Rank Fusion** 融合，与文档 RRF 推荐用法一致；`retrieve_method` 支持 `hybrid` 与 `rrf`。
- **请求参数**：`RetrieveRequest` 支持 `query`、`user_id`、`group_id`、`limit`、`memory_types`、`method`，与 API 文档主要字段一致。

### 3. 存储与索引

- **关系存储**：SQLite 表 `memories`，字段含 `id`、`type`、`content`、`user_id`、`group_id`、`created_at`、`updated_at`、`metadata`，并建 `user_id`/`type` 索引，与文档「按类型与用户持久化」一致。
- **向量存储**：LanceDB 按 `MemoryType` 分表，写入 embedding 与必要元数据（含 `user_id`/`group_id`），供向量检索与 user/group 过滤。

### 4. Prompt 与 LLM

- 各 Extractor 使用独立 prompt（`prompts.ts`），占位符与文档描述一致（如 `{{INPUT_TEXT}}`、`{{TIME}}`、`{{CONVERSATION_TEXT}}`、`{{EXISTING_PROFILES}}` 等）。
- 通过 `ICompletionProvider.generate` 调用 LLM，支持 temperature/json 等，与文档「LLM 用于抽取与推理」一致。

---

## 与文档的差异与取舍

### 1. 基础设施

| 文档 | 本实现 | 说明 |
|------|--------|------|
| MongoDB | SQLite | 单机、嵌入式，无独立 DB 服务。 |
| Elasticsearch (BM25) | SQLite LIKE + jieba | 关键词检索简化实现，非 BM25。 |
| Milvus | LanceDB | 向量检索本地化。 |
| Redis | 无 | 未实现缓存层。 |

### 2. Agentic 检索

- **文档**：支持 `retrieve_method: "agentic"`，多轮 LLM 查询扩展 + 并行检索 + RRF 融合。
- **本实现**：已实现。LLM 查询扩展（`IQueryExpansionProvider`/`DefaultQueryExpansionProvider`）-> 多条 query 并行 hybrid -> N-way RRF 融合。**仅在需要执行特别合适的任务时调用**（复杂/多意图查询），见 **RETRIEVAL_USAGE.md**。

### 3. EventLog 存储粒度

- **文档**：每个 `atomic_fact` 单独存为一条 EventLogRecord。
- **本实现**：已对齐，每个 atomic_fact 一条记录，单独 content/embedding，metadata 含 time、parent_type、parent_id。

### 4. Reranking

- **文档**：hybrid/agentic 可带 Reranker 深度排序。
- **本实现**：已接入。当 `RetrieveRequest.use_rerank === true` 且 `ILLMProvider.rerank` 存在时，在检索结果上调用 `rerank(query, docs)` 精排。**仅在需要高相关度精排的合适任务时使用**，见 **RETRIEVAL_USAGE.md**。

### 5. 边界检测与 MemCell 生成

- **文档**：由边界检测从连续对话中切出 MemCell。
- **本实现**：不实现边界检测，由上游（如 Prizm）按「每次 user+assistant 轮次」或会话单位构造 MemCell 并调用 `processMemCell`。

### 6. Group vs Personal Episode

- **文档**：区分 Group Episode（`user_id` 为空）与 Personal Episode（按用户）。
- **本实现**：Episode 统一带 `user_id`/`group_id`，未显式区分「仅 group」与「personal」两种记录类型；存储与检索均支持按 `user_id`/`group_id` 过滤。

### 7. Foresight / EventLog 仅 assistant 场景

- **文档**：Foresight、EventLog 仅在 assistant（1:1）场景抽取，不在 group chat 抽取。
- **本实现**：已对齐。MemCell 支持可选 `scene: 'assistant' | 'group'`；仅当 `memcell.scene !== 'group'` 时执行 Foresight 与 EventLog 抽取。调用方（如 Prizm）在 1:1 对话时传 `scene: 'assistant'`，群聊传 `scene: 'group'`。

---

## 源码遍历检查（packages/evermemos/src）

- **types.ts**：MemoryType、MemCell（含 scene）、EventLog/Foresight/Episode/Profile、RetrieveRequest（含 use_rerank）、IQueryExpansionProvider 与文档一致；RetrieveMethod 含 AGENTIC，检索时走 agenticSearch（查询扩展 + 多 query hybrid + N-way RRF）。
- **MemoryManager.ts**：processMemCell 按 Episode → Foresight/EventLog（仅 scene !== 'group'）→ Profile 并行；listMemories/deleteMemory 使用 SQLite；metadata 写入 JSON 字符串，由 SQLiteAdapter.parseResult 读时解析。
- **RetrievalManager.ts**：keywordSearch/vectorSearch 按 user_id/group_id 过滤；hybridSearch 为 keyword + vector + RRF；agenticSearch 为查询扩展 + 多 query hybrid + N-way RRF；当 use_rerank 且 llmProvider.rerank 存在时对结果做 rerank。
- **EventLogExtractor.ts**：每个 atomic_fact 一条 EventLog，单独 content/embedding，metadata 含 time、parent_type、parent_id。
- **ForesightExtractor / EpisodeExtractor / ProfileMemoryExtractor**：字段与 prompts 占位符与 memory_types_guide 一致。
- **storage/sqlite.ts**：memories 表结构、query 使用 parseResult 解析 metadata。
- **storage/lancedb.ts**：按 MemoryType 分表，写入 embedding 与 user_id/group_id 等供过滤。

未发现与 DOCS_COMPLIANCE 及 RETRIEVAL_USAGE 描述不一致的实现。

---

## 小结

- **记忆类型、提取顺序、Prompt 语义、RRF 融合、user_id/group_id 过滤**与文档一致或可对应。
- **存储与检索**采用 SQLite + LanceDB 的简化栈，检索语义与 API 文档对齐，但实现方式与文档中的 MongoDB/Elasticsearch/Milvus 不同。
- **Agentic 检索**与 **Reranking** 已实现，**仅在特别合适的任务时调用**（见 RETRIEVAL_USAGE.md）；**边界检测** 不实现；**EventLog 粒度**与 **Foresight/EventLog 仅 assistant** 已与文档对齐。
