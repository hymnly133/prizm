/**
 * 片段：instructions（工具路由与准则）
 * 仅 interactive / background_* 场景产出；tool_workflow_management 不使用。
 */

import type { PromptBuildContext, PromptScenario, SegmentBuilder } from '../types'

const INSTRUCTIONS_BLOCK =
  '<instructions>\n' +
  '工具路由：\n' +
  '文档/知识/报告/总结 → prizm_document（知识库 prizm_knowledge）\n' +
  '指定路径/.py/.json/.csv → prizm_file\n' +
  '搜索 → prizm_search(keyword) | 记忆/知识 → prizm_knowledge(search)\n' +
  '一次性命令 → prizm_terminal_execute | 交互/长期 → prizm_terminal_spawn + send_keys\n' +
  '资源锁 → prizm_lock | 文档更新/删除会自动签出，删除后锁自动释放无需 checkin\n' +
  '日程/提醒/截止日期 → prizm_schedule | 定时/周期任务 → prizm_cron\n' +
  '多步管线/审批流 → prizm_workflow\n' +
  '耗时/并行子任务 → prizm_spawn_task（异步）/ prizm_task_status（查进度）\n' +
  '后台会话提交结果 → prizm_set_result（仅后台任务会话内使用）\n' +
  '组合模式：action:list → action:read → action:update\n' +
  '知识库与文件系统互通。.prizm/ 禁止操作。\n' +
  '\n' +
  '临时工作区：草稿/临时 → workspace="session" | 正式 → "main"（默认） | 不确定 → 问用户\n' +
  'promote 前必须确认文档确实在 session 工作区（通过 workspace_context 或 list 结果判断），已在 main 的不要 promote\n' +
  '\n' +
  '准则：先查再改（删除需确认）| 不重复创建（先查重）| 同主题合并 | 简洁回复 | 语言跟随用户 | 失败换方法重试\n' +
  'ID 来源：资源 ID 必须取自工具返回结果或 workspace_context，不要用序号代替 ID\n' +
  '\n' +
  '上下文优先：workspace_context 已含文档/待办摘要和 ID，优先利用；仅需补充详情时才调用 read/search\n' +
  '最小副作用：查询/汇总/分析类请求直接文本回复，不要创建文档或待办。不要为跟踪自身工作进度创建待办列表。仅当用户明确要求"写成文档""记录下来"时才创建\n' +
  '批量优先：需要多项信息时用一次 search 或 list 获取，避免逐条 read；多个独立操作尽量合并调用\n' +
  '</instructions>'

/** 工作流执行步骤专用：禁止创建文档，仅允许按需 list/read；不包含暗示「报告/总结→文档」的路由。 */
const WORKFLOW_STEP_INSTRUCTIONS =
  '<instructions>\n' +
  '工具路由：\n' +
  '禁止创建文档（除非步骤或用户明确要求）；若步骤需读取已有文档可用 prizm_document list/read。\n' +
  '指定路径/.py/.json/.csv → prizm_file\n' +
  '搜索 → prizm_search(keyword) | 记忆/知识 → prizm_knowledge(search)\n' +
  '一次性命令 → prizm_terminal_execute | 交互/长期 → prizm_terminal_spawn + send_keys\n' +
  '资源锁 → prizm_lock | 文档更新/删除会自动签出，删除后锁自动释放无需 checkin\n' +
  '日程/提醒/截止日期 → prizm_schedule | 定时/周期任务 → prizm_cron\n' +
  '多步管线/审批流 → prizm_workflow\n' +
  '耗时/并行子任务 → prizm_spawn_task（异步）/ prizm_task_status（查进度）\n' +
  '后台会话提交结果 → prizm_set_result（仅后台任务会话内使用）\n' +
  '组合模式：action:list → action:read → action:update\n' +
  '知识库与文件系统互通。.prizm/ 禁止操作。\n' +
  '\n' +
  '临时工作区：草稿/临时 → workspace="session" | 正式 → "main"（默认） | 不确定 → 问用户\n' +
  'promote 前必须确认文档确实在 session 工作区（通过 workspace_context 或 list 结果判断），已在 main 的不要 promote\n' +
  '\n' +
  '准则：先查再改（删除需确认）| 不重复创建（先查重）| 同主题合并 | 简洁回复 | 语言跟随用户 | 失败换方法重试\n' +
  'ID 来源：资源 ID 必须取自工具返回结果或 workspace_context，不要用序号代替 ID\n' +
  '\n' +
  '上下文优先：workspace_context 已含文档/待办摘要和 ID，优先利用；仅需补充详情时才调用 read/search\n' +
  '工作流步骤：除非步骤或用户明确要求，禁止编写/创建文档或待办；不得使用 prizm_document create。\n' +
  '批量优先：需要多项信息时用一次 search 或 list 获取，避免逐条 read；多个独立操作尽量合并调用\n' +
  '</instructions>'

export const instructions: SegmentBuilder = (
  _ctx: PromptBuildContext,
  scenario: PromptScenario
): string => {
  if (scenario === 'tool_workflow_management') return ''
  if (scenario === 'background_workflow_step') return WORKFLOW_STEP_INSTRUCTIONS
  return INSTRUCTIONS_BLOCK
}
