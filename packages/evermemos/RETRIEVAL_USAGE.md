# 检索使用说明与推荐方式

本包提供传统检索（keyword / vector / hybrid）以及 **Agentic**、**Rerank**。**Agentic 与 Rerank 仅在需要执行特别合适的任务时调用**（见下文）。

---

## 1. 检索方法

| method | 说明 | 推荐场景 |
|--------|------|----------|
| **KEYWORD** | SQLite LIKE + 分词（jieba），按 `user_id`/`group_id` 过滤 | 精确词、短语、低延迟；无向量时 |
| **VECTOR** | LanceDB 向量检索，按 `memory_types`、`user_id`/`group_id` 过滤 | 语义相似、表述不同但意思相近 |
| **HYBRID / RRF** | 并行 keyword + vector，再用 RRF 融合 | **默认推荐**，兼顾关键词与语义 |
| **AGENTIC** | LLM 查询扩展 -> 多 query 并行 hybrid -> N-way RRF 融合 | **仅**复杂/多意图查询、需更高召回时 |
| **Rerank** | 检索结果用 `ILLMProvider.rerank` 精排（需传 `use_rerank: true`） | **仅**需要高相关度精排时（多一次 LLM 调用） |

---

## 2. 使用方式

### 2.1 请求参数（RetrieveRequest）

```ts
interface RetrieveRequest {
  query: string
  user_id?: string   // 建议必传，否则 keyword 不过滤用户
  group_id?: string
  limit?: number     // 默认 10
  memory_types?: MemoryType[]  // 默认 [EPISODIC_MEMORY]
  method?: RetrieveMethod      // KEYWORD | VECTOR | HYBRID | RRF | AGENTIC
  use_rerank?: boolean         // 是否在结果上做 rerank 精排；仅在需要高相关度时显式开启
}
```

### 2.2 推荐用法

**默认推荐（大多数场景）**

- `method: RetrieveMethod.HYBRID` 或 `RetrieveMethod.RRF`
- 必传 `user_id`（或 `group_id`），保证结果隔离
- `memory_types` 按需传，例如 `[MemoryType.EPISODIC_MEMORY, MemoryType.EVENT_LOG]`
- `limit` 一般 10–20

**只要关键词、要极低延迟**

- `method: RetrieveMethod.KEYWORD`
- 必传 `user_id` / `group_id`

**只要语义、不要关键词**

- `method: RetrieveMethod.VECTOR`
- 必传 `user_id` / `group_id`

### 2.3 调用示例

```ts
import { RetrievalManager, RetrieveMethod, MemoryType } from '@prizm/evermemos'

const results = await retrievalManager.retrieve({
  query: '用户喜欢的运动',
  user_id: 'user_001',
  method: RetrieveMethod.HYBRID,
  memory_types: [MemoryType.EPISODIC_MEMORY, MemoryType.EVENT_LOG],
  limit: 15
})
```

---

## 3. 按查询需求选 memory_types

| 需求 | 推荐 memory_types |
|------|-------------------|
| 叙事/故事上下文 | `[EPISODIC_MEMORY]` |
| 精确事实、谁何时做了什么 | `[EVENT_LOG]` 或 `[EPISODIC_MEMORY, EVENT_LOG]` |
| 未来提醒、时间相关 | `[FORESIGHT]` |
| 用户画像/偏好 | `[PROFILE]`（若已抽取） |

---

## 4. Agentic 与 Rerank（仅在特别合适的任务时使用）

- **Agentic**（`method: RetrieveMethod.AGENTIC`）：使用 LLM 将用户 query 扩展为 2～3 条子查询，每条做 hybrid 检索，再用 N-way RRF 融合。**适用**：复杂问句、多意图、需要更高召回时。**成本**：多轮 LLM 调用（扩展 + 各 query 的 embedding），仅在确实需要时使用。
- **Rerank**（`use_rerank: true`）：在任意 method 得到结果后，若 `ILLMProvider.rerank` 存在，则对结果做精排。**适用**：需要高相关度、结果顺序敏感时。**成本**：多一次 LLM 调用；且需接入方实现 `ILLMProvider.rerank(query, docs)` 返回与 `docs` 等长的相关度分数数组。

**推荐**：日常检索用 HYBRID；仅当任务明确需要更高召回或精排时再选用 AGENTIC 和/或 `use_rerank: true`。

---

## 5. 小结

- **默认**：`method: HYBRID` 或 `RRF`，传 `user_id`，按需设 `memory_types`、`limit`。
- **要快**：`method: KEYWORD`。
- **要语义**：`method: VECTOR`。
- **复杂/多意图**：`method: AGENTIC`（仅适合时调用）。
- **要高相关度精排**：`use_rerank: true` 且接入方实现 `rerank()`（仅适合时调用）。
