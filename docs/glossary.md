# Prizm 术语表

便于从其他项目迁移或首次接触时对照的核心术语说明。

| 术语 | 说明 |
|------|------|
| **Scope** | 数据隔离的工作区。便签、待办、文档、Agent 会话等均按 scope 存储，不同 scope 互不影响。通过请求头 `X-Prizm-Scope` 或查询参数 `?scope=` 指定。 |
| **default** | 默认 scope，通用用途。未指定 scope 时使用。 |
| **online** | 与 Electron 客户端常驻展示一致的 scope，推荐 MCP/Agent 默认使用；与「在线」语义对应。 |
| **MCP** | Model Context Protocol。Prizm 通过 MCP 向 Cursor、LobeChat 等 AI 工具暴露本机上下文（便签、任务、剪贴板、文档），使其可读取和操作桌面数据。 |
| **Agent** | Prizm 内置的 LLM 驱动对话能力，支持流式回复、工具调用（文档、待办、锁、搜索等）、审批流程。需至少配置一个 LLM API Key（小米 MiMo、智谱或 OpenAI 兼容）。 |
| **工作流** | 多步骤自动化流水线，可将多个 Agent 任务、人工审批、数据变换编排为可复用流程。支持事件触发、超时、审批与恢复。详见 [工作流系统](workflow-system.md)。 |
| **Embedding** | 本地向量模型，默认启用，用于记忆与检索（如文档摘要、会话记忆）。无需上云即可做语义检索。详见 [本地 Embedding](local-embedding.md)。 |
| **Dashboard** | 内置 Web 管理面板（`/dashboard/`），用于全面查看数据（概览、便签、待办、文档、剪贴板、Agent 会话、Token 等）与系统级配置。 |
| **反馈** | 用户对创造性输出（对话回复、文档、工作流运行、任务结果等）的评价（喜欢/一般/不喜欢 + 可选评语）。用于审计与偏好记忆提取，详见 [反馈系统](feedback-system.md)。 |
| **适配器** | 服务端与底层存储/通知等解耦的接口模式。可替换为自定义实现以嵌入现有应用。 |
