# 本地 Embedding 模型集成

本地 embedding 模型已集成到 Prizm Server，默认启用。

## 实现概要

### 模型信息

| 属性 | 值 |
|------|------|
| 默认模型 | [TaylorAI/bge-micro-v2](https://huggingface.co/TaylorAI/bge-micro-v2) |
| 维度 | 384 |
| 参数量 | ~17.2M |
| 运行时 | ONNX Runtime（@huggingface/transformers） |
| Node.js 兼容 | ✅ 通过 Transformers.js v3 |

### 核心文件

- `prizm/src/llm/localEmbedding.ts` — `LocalEmbeddingService` 类（单例模式）
- `prizm/src/routes/embedding.ts` — 调试/管理路由
- `prizm/src/config.ts` — 配置项（embedding 相关）
- `prizm/src/llm/localEmbedding.test.ts` — 单元测试

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PRIZM_EMBEDDING_ENABLED` | `true` | 是否启用本地 embedding |
| `PRIZM_EMBEDDING_MODEL` | `TaylorAI/bge-micro-v2` | HuggingFace 模型 ID |
| `PRIZM_EMBEDDING_CACHE_DIR` | `{dataDir}/models` | 模型缓存目录 |
| `PRIZM_EMBEDDING_MAX_CONCURRENCY` | `1` | 最大并发推理数 |

### API 端点

- `GET /embedding/status` — 返回模型状态和推理统计
- `POST /embedding/test` — 测试文本嵌入（支持相似度比较）
- `POST /embedding/reload` — 热重载模型
- `GET /health` — 健康检查（含 embedding 状态摘要）

### 生命周期

1. 服务启动时 `initEverMemService()` 调用 `localEmbedding.init()`
2. 模型通过 `@huggingface/transformers` 的 `pipeline('feature-extraction')` 加载
3. 加载成功后自动注册到 `EverMemService.registerLocalEmbeddingProvider()`
4. 加载失败不阻塞服务，回退到 mock embedding

### 监控统计

`LocalEmbeddingService.getStatus()` 返回：模型状态、推理统计、模型加载耗时、进程内存占用等。

## 注意事项

- 首次运行会下载模型文件（~30–60MB），需要网络访问
- 模型缓存到 `{dataDir}/models/` 目录（可通过 `PRIZM_EMBEDDING_CACHE_DIR` 自定义）
- ONNX Runtime 在 Windows/macOS/Linux 均可用
- 模型加载是异步的，加载完成前的 embedding 请求使用 mock 回退
- 向量维度 384 与现有 LanceDB 表结构一致，无需数据迁移
