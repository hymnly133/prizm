# Stagehand 自定义 LLM Client 约定与集成

本文档整理 Stagehand **官方文档、官方指导与社区实现**，供 Prizm 实现 `PrizmStagehandLLMClient` 时参考，确保真正的合规自定义 Client 集成。

---

## 官方文档与入口

| 来源 | 链接 | 说明 |
|------|------|------|
| **Models 配置** | [docs.stagehand.dev/configuration/models](https://docs.stagehand.dev/configuration/models) | 首选模型、自定义 Client、AISdkClient、Custom Endpoints |
| **Extending the AI SDK Client** | 同上页 “Advanced Options” 小节 | 官方推荐：继承 `LLMClient`，在 `createChatCompletion` 内实现重试 + 退避 |
| **文档索引** | [docs.stagehand.dev/llms.txt](https://docs.stagehand.dev/llms.txt) | 全量文档索引 |
| **GitHub 仓库** | [github.com/browserbase/stagehand](https://github.com/browserbase/stagehand) | 源码与示例 |
| **外部 Client 示例** | [examples/external_clients/](https://github.com/browserbase/stagehand/tree/main/examples/external_clients) | `customOpenAI.ts`（OpenAI 兼容）、`aisdk.ts`（Vercel AI SDK）等模板 |
| **LLM Customization 示例** | [stagehand.readme-i18n.com/examples/custom_llms](https://stagehand.readme-i18n.com/examples/custom_llms) | 自定义 LLM 使用说明 |

---

## 使用方式

构造 Stagehand 时传入 `llmClient`，不再传 `model`：

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: { cdpUrl: "..." },
  llmClient: myCustomClient,  // 自定义 client
});

await stagehand.init();
```

---

## 自定义 Client 的约定

### 1. 基类与方法

- 官方推荐继承 **`LLMClient`**（从 `@browserbasehq/stagehand` 导出），并实现 **`createChatCompletion`**。
- 若不继承（如 Prizm 使用自有 provider），自定义对象需实现**相同调用约定**（入参/返回值见下）。
- **Extending the AI SDK Client** 官方示例：在 `createChatCompletion` 内实现重试，并在每次重试前**退避等待**（避免瞬时限流）。

官方文档示例（重试 + 退避）：

```typescript
import { LLMClient } from "@browserbasehq/stagehand";

class CustomRetryClient extends LLMClient {
  async createChatCompletion(options) {
    let retries = 3;
    while (retries > 0) {
      try {
        return await super.createChatCompletion(options);
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await new Promise((r) => setTimeout(r, 1000 * (4 - retries)));
      }
    }
  }
}
```

Prizm 实现：不继承 `LLMClient`（因使用自有 `provider.chat` 流式接口），但实现了相同入参/返回值约定，并在 JSON 解析或 Zod 校验失败时按 `retries` 重试，重试前执行 `delayBeforeRetry(retriesLeft)`（退避 1s～N s）。

### 2. 方法签名

Stagehand 内部调用形式为：

```ts
const rawResponse = await llmClient.createChatCompletion({
  options: {
    messages: Array<{ role: 'system'|'user'|'assistant'; content: string | Array<{ type; text?; image_url?; source? }> }>,
    temperature?: number,
    top_p?: number,
    frequency_penalty?: number,
    presence_penalty?: number,
    response_model?: {
      name: string,
      schema: ZodSchema,  // 带 .parse(data) 的 Zod 对象
    },
  },
  logger?: (line: { message?: string; category?: string; level?: number; auxiliary? }) => void,
  retries?: number,
});
```

- **入参**：一个对象，至少包含 `options`（含 `messages`、可选的 `response_model` 等），可选 `logger`、`retries`。
- **messages**：与 OpenAI 风格一致；`content` 可为字符串或多 part（含 `text`、`image_url`/`source` 等，用于多模态）。

### 3. 返回值形状

`createChatCompletion` 必须返回 **Promise**，resolve 为：

```ts
{
  data: T,     // 有 response_model 时为 schema 解析后的对象；否则为 string（模型原始文本）
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    reasoning_tokens?: number;
    cached_input_tokens?: number;
  }
}
```

- **有 `response_model` 时**：Stagehand 会直接用 `data` 做后续逻辑（如 act 的 elementId/description/method/arguments/twoStep，observe 的 elements，extract 的 extraction 等），因此 **`data` 必须已通过 `response_model.schema.parse(...)` 校验**，否则会抛 Zod 错误。
- **无 `response_model` 时**：`data` 为 string 即可。

### 4. 官方对 “OpenAI 风格” 客户端的实现要点（源码）

在 `CustomOpenAIClient` 中，当存在 `response_model` 时，官方实现会：

1. 要求模型返回 JSON（如通过 `response_format: { type: "json_object" }` 或额外 system/user 说明）。
2. 从响应中取出 `message.content`，先 `JSON.parse`，失败时用 **jsonrepair** 再试。
3. **对 observe 做一次规范化**：若 `parsedData.elements` 存在，则把每个元素规范成 `{ elementId, description, method, arguments }`（缺的补默认值）。
4. 调用 **`validateZodSchema(options.response_model.schema, parsedData)`**（即 Zod 的 parse），通过后才返回 `{ data: parsedData, usage }`。

因此自定义 client 若直接返回“未按 schema 校验/未规范化”的 JSON，容易触发 Stagehand 内部的 Zod 报错（例如 act 期望 `elementId` 却拿到 `selector`，observe 期望 `{ elements }` 却拿到数组）。

### 5. 与 Vercel AI SDK 的兼容方式

官方推荐用 **`AISdkClient`** 接任意 [Vercel AI SDK](https://sdk.vercel.ai/providers) 的 provider：

```typescript
import { createGoogle } from '@ai-sdk/google';
import { AISdkClient } from '@browserbasehq/stagehand';

const googleClient = new AISdkClient({
  model: googleProvider("google/gemini-2.5-flash"),
});

const stagehand = new Stagehand({
  env: "BROWSERBASE",
  llmClient: googleClient,
});
```

自定义 endpoint（如 Hugging Face、自建 OpenAI 兼容）时，同样用对应 AI SDK provider 构造 `AISdkClient`，或自写一个实现上述 `createChatCompletion` 约定的对象。

---

## Prizm 侧实现要点（PrizmStagehandLLMClient）

- **入参**：与上述一致，使用 `options.messages`、`options.response_model`、`options.temperature` 等；支持 `logger`、`retries`。
- **调用**：用 Prizm 的 `provider.chat()` 消费流，得到完整文本后再处理。
- **有 `response_model` 时**：  
  - 先 `JSON.parse(text)`，必要时用 **jsonrepair**。  
  - 若解析失败且 **schemaName === 'Extraction'**：将整段 `text` 视为抽取内容，即 `raw = { extraction: text.trim() }`（兼容模型直接返回纯文本/中文等非 JSON）。  
  - 再按 **schema name** 做**规范化**（act: `selector`→`elementId`、补 `twoStep`/`arguments`；Observation: 数组→`{ elements }` 并规范每项；Extraction: string/null→`{ extraction }`；Metadata: 缺字段→`{ progress, completed }`），最后用 `response_model.schema.parse(normalized)`，通过后返回 `{ data: parsed, usage }`。
- **重试**：当 JSON 解析或 Zod 校验失败且 `retries > 0` 时，自动重试（递减 retries），与官方 “Extending the AI SDK Client” 行为一致。
- **usage**：与官方一致，包含 `prompt_tokens`、`completion_tokens`、`total_tokens` 等，从 Prizm provider 的 usage 映射。
- **logger**：在发起调用、成功返回及解析/校验失败时调用 `params.logger`，便于调试与排查。

这样既满足“自定义 Client”的官方约定，又避免因模型输出格式与 Stagehand 内部 Zod 不一致而导致的 act/observe/extract 报错。

---

## 集成检查清单（真正好的自定义 Client）

- [ ] **入参**：`createChatCompletion({ options, logger?, retries? })`，`options` 含 `messages`、`response_model`（name + Zod schema）、`temperature` 等。
- [ ] **返回值**：`{ data, usage? }`，有 `response_model` 时 `data` 必须已通过 `schema.parse()`，否则 Stagehand 会抛 Zod 错误。
- [ ] **response_model 处理**：从模型拿到文本后先 `JSON.parse`，失败则 `jsonrepair`；再按 schema name 做**字段规范化**（act: elementId/selector、observe: elements 数组、Extraction: extraction、Metadata: progress/completed），最后 `schema.parse(normalized)`。
- [ ] **Extraction 纯文本回退**：当 schema 为 Extraction 且 JSON 解析失败时，将整段回复视为 `{ extraction: text }`，兼容非 JSON 输出。
- [ ] **重试与退避**：解析或校验失败且 `retries > 0` 时，先 `await delay(retriesLeft)` 再重试，与官方 “Extending the AI SDK Client” 一致。
- [ ] **logger**：在发起请求、成功返回、解析/校验失败时调用 `logger`，便于排查。
- [ ] **usage**：返回 `prompt_tokens`、`completion_tokens`、`total_tokens`、`reasoning_tokens?`、`cached_input_tokens?`，与 Stagehand 内部统计兼容。

## 参考

- 官方 Models 文档：<https://docs.stagehand.dev/configuration/models>
- 官方 “Extending the AI SDK Client”：同页 “Advanced Options” 小节
- 外部 Client 模板：<https://github.com/browserbase/stagehand/tree/main/examples/external_clients>
- Stagehand 源码（dist）：`node_modules/@browserbasehq/stagehand/dist/index.js` 中 `LLMClient`、`AISdkClient`、`CustomOpenAIClient` 及 `createChatCompletion` 的实现与返回形状
