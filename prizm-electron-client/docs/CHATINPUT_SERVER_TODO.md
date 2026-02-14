# 聊天框服务端待办

本文档记录 ChatInput（@lobehub/editor 风格输入框）相关功能的服务端对接待办。

## 当前实现

### 客户端（prizm-electron-client）

- 富文本输入（Lexical 编辑器）
- 占位符「从任何想法开始」
- 悬浮面板外观（borderRadius: 20，boxShadow）
- 左侧功能按钮（Upload 占位、Clear 清空/新建会话）
- 右侧展开 + 发送

### 服务端（prizm）

- `POST /agent/sessions/:id/chat`：发送纯文本消息，`body: { content: string, model?: string }`
- 流式 SSE 响应，无文件/附件支持

---

## 待办

### 1. 文件上传

| 项目 | 说明 |
|------|------|
| **现状** | Upload 按钮为占位，点击仅 console 提示 |
| **需求** | 支持在输入框内附加文件（图片、文档等） |
| **接口** | 可复用 `/notes` 或新增 `POST /agent/upload`、`POST /agent/sessions/:id/attachments` |
| **参考** | LobeHub `useUploadFiles`、`DragUploadZone`、`usePasteFile` |

**实现要点：**

- 定义附件存储路径（如 `.prizm-data/attachments/{scope}/{sessionId}/`）
- 支持 multipart/form-data 或 base64 内联
- 扩展 `POST /agent/sessions/:id/chat` 的 `body`，增加 `attachments?: Array<{ url: string; type: string }>`
- 或先上传返回 URL，再在 chat 请求中引用

---

### 2. 知识库 / 文件检索（RAG）

| 项目 | 说明 |
|------|------|
| **现状** | 未接入 |
| **需求** | 输入时关联知识库、检索引用 |
| **参考** | LobeHub 资源库、RAG 相关 |

**实现要点：**

- 知识库数据源（文档、笔记）的索引与检索
- 可考虑向量检索（需引入 embedding 服务）
- 扩展 chat 请求支持 `context?: { knowledgeBaseIds?: string[] }`

---

### 3. 语音输入（STT）

| 项目 | 说明 |
|------|------|
| **现状** | 未接入 |
| **需求** | 语音转文字输入 |
| **参考** | @lobehub/tts、LobeHub ActionBar/STT |

**实现要点：**

- 新增 `POST /agent/stt` 或 `/agent/sessions/:id/stt`，接收音频（如 webm、wav）
- 调用 STT 服务（如 Whisper API、本地模型）返回文本
- 客户端录音后上传，将返回文本填入输入框

---

### 4. 其它 LobeHub 功能（可选）

| 功能 | 说明 |
|------|------|
| 模型切换、参数面板 | 需扩展 `IAgentAdapter.chat` 的 options，支持 temperature、maxTokens 等 |
| 联网搜索 | 需接入搜索 API，在 chat 前/中注入搜索结果 |
| 插件 / MCP 调用 | 需定义插件协议与路由 |
| 提及成员（@mention） | 多为前端展示逻辑，服务端可解析 `@id` 做权限或通知 |

---

*创建于引入 @lobehub/editor 完整复刻 LobeHub 聊天输入框时*
