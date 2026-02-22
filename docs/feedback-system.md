# 反馈系统

用户对创造性输出（对话回复、文档、工作流运行、后台任务等）进行评价收集，并与审计、记忆偏好系统联动。

---

## 1. 概述

- **用途**：在 Agent 回复、知识库文档、工作流运行结果、后台任务完成等场景下，让用户选择「喜欢 / 一般 / 不喜欢」并可选填写评语，用于偏好学习与产品改进。
- **数据流**：提交反馈 → 写入 SQLite（`.prizm-data/feedback.db`）→ 触发领域事件 `feedback:submitted` → 审计记录、偏好记忆提取、WebSocket 广播。
- **偏好闭环**：对「喜欢」或「不喜欢」的反馈会通过 EverMemService 写入 profile 类记忆，在后续对话中影响系统提示词与回复风格。

---

## 2. 用户入口（Electron 客户端）

| 场景 | 位置 | 组件形态 |
|------|------|----------|
| Agent 单条回复 | 每条 assistant 消息尾部（与 token 用量、记忆标签并排） | 行内（inline） |
| 工作流运行结果 | 运行完成/失败后的结果区下方 | 卡片（card） |
| 知识库文档 | 文档编辑器底部状态栏右侧 | 行内（inline） |
| 后台任务 | 任务完成/失败/超时后的历史记录卡片 | 行内（inline） |
| 反馈概览 | 首页（工作台）总览区 | 好评率环形图 + 最近反馈列表 |

交互：点击「喜欢 / 一般 / 不喜欢」图标即可提交；可再点「添加评语」输入文字（最多 2000 字）；提交后显示感谢提示。

---

## 3. 数据模型（共享类型）

- **FeedbackRating**：`'like' | 'neutral' | 'dislike'`
- **FeedbackTargetType**：`'chat_message' | 'document' | 'workflow_run' | 'workflow_step' | 'task_run'`
- **FeedbackEntry**：id、scope、targetType、targetId、sessionId（可选）、rating、comment（可选）、clientId、metadata、createdAt、updatedAt

同一 scope + targetType + targetId + clientId 仅保留一条反馈（upsert）。

---

## 4. API 端点

均需认证；除列表/统计外需传 scope（`X-Prizm-Scope` 或 `?scope=`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/feedback` | 提交反馈（body: targetType, targetId, sessionId?, rating, comment?, metadata?） |
| GET | `/feedback` | 查询列表（query: targetType, targetId, sessionId, rating, since, until, limit, offset） |
| GET | `/feedback/stats` | 聚合统计（query: targetType?, sessionId?） |
| GET | `/feedback/target/:targetType/:targetId` | 获取某目标的反馈列表 |
| PATCH | `/feedback/:id` | 更新反馈（body: rating?, comment?） |
| DELETE | `/feedback/:id` | 删除反馈 |

---

## 5. 领域事件与联动

- **事件名**：`feedback:submitted`
- **Payload**：scope、feedbackId、targetType、targetId、rating、comment?、sessionId?、actor?

**下游处理**（在服务端事件总线中注册）：

1. **审计**：写入 Agent 审计日志（resourceType=`feedback`，action=`create`）。
2. **偏好记忆**：当 rating 为 `like` 或 `dislike` 时，构造偏好描述文本，通过 EverMemService 的 `addMemoryInteraction` 写入 profile 类记忆；`neutral` 不写入。
3. **WebSocket**：通过 wsBridge 向已订阅的客户端广播 `feedback:submitted`，便于多端同步展示。

---

## 6. 存储与生命周期

- **存储**：SQLite 数据库 `.prizm-data/feedback.db`，表 `feedback`，索引含 scope、target、session、rating、时间等。
- **生命周期**：服务启动时 `feedbackManager.init()` 初始化存储并启动定时裁剪；关闭时 `feedbackManager.shutdown()`。超过 365 天的反馈会被定时任务清理。

---

## 7. 相关文档

- 架构与 API 总览：[CLAUDE.md](../CLAUDE.md)
- 记忆系统（profile 等）：[prizm/MEMORY_SYSTEM.md](../prizm/MEMORY_SYSTEM.md)
- 用户手册（含反馈入口说明）：[用户手册](USER_GUIDE.md)
