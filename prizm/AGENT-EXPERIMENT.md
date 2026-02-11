# Prizm Agent 交互实验场景

本场景用于实验 Prizm MCP 的 Agent 交互功能，模拟“从便签检测任务 → 创建 10 步 TODO → 记录、通知、更新”的完整流程。

## 前置条件

1. **Prizm 服务运行**：`cd prizm && yarn start` 或 `yarn dev`
2. **Electron 客户端运行**（可选，用于接收通知）：`cd prizm-electron-client && yarn dev:electron`
3. **Cursor MCP 已配置** `user-prizm` 服务器

## 场景步骤（10 步）

| 步骤 | 动作 | 使用工具 | 说明 |
|------|------|----------|------|
| 1 | 查看便签 | `prizm_list_notes` | 列出所有便签，检测其中是否包含任务描述 |
| 2 | 搜索任务相关便签 | `prizm_search_notes` | 用关键词「任务」「优化」「todo」等搜索 |
| 3 | 创建任务 1 | `prizm_create_task` | 根据便签内容创建第一个任务 |
| 4 | 创建任务 2 | `prizm_create_task` | 创建第二个任务 |
| 5 | 创建任务 3 | `prizm_create_task` | 创建第三个任务 |
| 6 | 创建任务 4 | `prizm_create_task` | 创建第四个任务 |
| 7 | 创建任务 5 | `prizm_create_task` | 创建第五个任务 |
| 8 | 创建任务 6–10 | `prizm_create_task` | 完成剩余 5 个任务 |
| 9 | 记录汇总 | `prizm_create_note` | 创建便签记录本次任务分解结果 |
| 10 | 通知用户 | `prizm_notice` | 发送通知到 Electron 客户端 |

## 可选扩展步骤

- **更新任务状态**：使用 `prizm_update_task` 将部分任务标记为 `doing` 或 `done`
- **列出任务**：使用 `prizm_list_tasks` 验证已创建的任务（可按 `todo`/`doing`/`done` 过滤）

## 示例便签（用于触发场景）

若便签为空，可先添加一条示例便签：

```
优化十个 prizm 项目编程实践上的小问题：
1. 类型安全 2. 错误处理 3. 日志规范 4. 配置管理 5. 测试覆盖
6. 文档注释 7. 代码风格 8. 依赖版本 9. 安全性 10. 性能
```

这样 Agent 可从中解析出 10 个具体任务并创建 TODO。

## 可用 Prizm MCP 工具

| 工具 | 用途 |
|------|------|
| `prizm_list_notes` | 列出便签，可选 `q` 关键词过滤 |
| `prizm_search_notes` | 按 `query` 搜索便签内容 |
| `prizm_create_note` | 创建便签 |
| `prizm_list_tasks` | 列出任务，可选 `status` 过滤 |
| `prizm_create_task` | 创建任务 |
| `prizm_update_task` | 更新任务状态/标题/优先级 |
| `prizm_get_clipboard` | 获取剪贴板历史 |
| `prizm_notice` | 发送通知到 Electron 客户端 |

## 实验提示词（给 Agent）

> 请使用 Prizm MCP 完成以下实验：
>
> 1. 先用 `prizm_list_notes` 或 `prizm_search_notes` 查看现有便签，检测其中是否包含可分解为任务的内容
> 2. 根据便签内容创建 10 个 TODO 任务（若便签内容不足 10 条，可自行补充合理的任务标题）
> 3. 用 `prizm_create_note` 记录本次任务分解的汇总
> 4. 用 `prizm_notice` 通知用户「任务分解已完成」
> 5. 可选：用 `prizm_update_task` 将第 1 个任务标记为 `doing`
