/**
 * 工具使用注意事项注册表（Tool Hint Registry）
 *
 * 分层描述模式：
 * - 第 1 层：工具 schema description —— 精简场景引导 + 核心用法（每轮必传）
 * - 第 2 层：首次调用注入 —— 关键注意事项（仅首次执行时内联到结果中）
 *
 * 以**工具组**为单位管理：
 * - 每个 Guide 对应一个工具组（如 terminal 组、lock 组）
 * - 首次调用组内任意工具 → 正常执行，结果末尾附带注意事项
 * - 同一 session 内后续调用 → 纯结果，不追加任何额外内容
 * - 查阅状态以 session 为单位（跨 chat 轮次有效，session 删除时清除）
 */

/* ------------------------------------------------------------------ */
/*  Guide 注册表                                                       */
/* ------------------------------------------------------------------ */

export interface ToolGuide {
  /** 工具组标识 */
  category: string
  /** 组内所有工具名 */
  toolNames: string[]
  /** 首次调用时注入的注意事项（精简，3-5 行） */
  firstCallHint: string
}

const GUIDES: ToolGuide[] = [
  {
    category: 'workspace_io',
    toolNames: ['prizm_file', 'prizm_document', 'prizm_todo', 'prizm_promote_file'],
    firstCallHint: [
      '[工作区注意事项]',
      '· workspace 参数: "main"（默认主工作区）/ "session"（临时工作区）/ "run"（运行工作区，步骤间数据传递）/ "workflow"（工作流工作区，跨 run 共享）',
      '· 工作流上下文中默认操作在运行工作区，需访问主工作区请显式传 workspace:"main"',
      '· workflow 工作区存放跨 run 保留的数据（明确要求、注意事项、经验总结等），run 工作区存放本次运行临时数据',
      '· 使用 prizm_promote_file 可将临时/运行工作区的文件提升到主工作区'
    ].join('\n')
  },
  {
    category: 'terminal',
    toolNames: ['prizm_terminal_execute', 'prizm_terminal_spawn', 'prizm_terminal_send_keys'],
    firstCallHint: [
      '[注意事项]',
      '· send_keys: pressEnter 控制回车，不要在 input 中手动添加 \\n 或 \\r',
      '· workspace: "main"（默认，项目根目录）/ "session"（临时目录）/ "run"（运行工作区）/ "workflow"（工作流工作区）',
      '· 禁止执行 rm -rf /、删除系统文件等危险操作'
    ].join('\n')
  },
  {
    category: 'lock',
    toolNames: ['prizm_lock'],
    firstCallHint: [
      '[注意事项]',
      '· 同一文档同时只有一个会话可持有锁',
      '· 编辑完成后务必 checkin/release 释放锁，否则其他会话无法操作',
      '· checkout 返回文档内容和 fenceToken，后续 update 自动验证'
    ].join('\n')
  },
  {
    category: 'workflow',
    toolNames: ['prizm_workflow'],
    firstCallHint: [
      '[注意事项]',
      '· run 是异步启动，立即返回 runId，后续用 status action 轮询进度',
      '· 调用已注册工作流前，先用 get_def 查看定义和所需参数（argsSchema）',
      '· step.type 仅限 agent/approve/transform，不要编造其他类型',
      '· id 可省略（自动生成）',
      '· 步骤间数据传递: input 省略时自动继承上一步输出（隐式管道），也可显式引用 $prev.output 或 $stepId.output',
      '· agent 需 prompt，approve 需 approvePrompt，transform 需 transform 表达式',
      '· step 可选: description, input, condition, model, timeoutMs, sessionConfig, retryConfig, linkedActions',
      '· 顶层 config 可配置: errorStrategy(fail_fast/continue), workspaceMode(dual/shared/isolated), maxTotalTimeoutMs, notifyOnComplete/notifyOnFail'
    ].join('\n')
  },
  {
    category: 'workflow_management',
    toolNames: ['workflow-management-create-workflow', 'workflow-management-update-workflow'],
    firstCallHint: [
      '[工作流管理会话]',
      '· 未绑定时使用 workflow-management-create-workflow 提交一次，成功后会话自动绑定该工作流',
      '· 已绑定后仅使用 workflow-management-update-workflow 增量修改，保留用户未提及部分不变',
      '· 参数为完整 WorkflowDef JSON，服务端校验失败会返回具体错误便于修正'
    ].join('\n')
  },
  {
    category: 'navigate',
    toolNames: ['prizm_navigate'],
    firstCallHint: [
      '[注意事项]',
      '· 当用户需求涉及「创建/设计工作流」且较复杂时，使用 prizm_navigate 引导到工作流创建会话',
      '· 先给出简短引导语（如：这个问题比较复杂，交给我的工作流分身来帮你一步步设计吧）',
      '· target 填 workflow-create，initialPrompt 填入从当前对话提炼的初步需求摘要'
    ].join('\n')
  },
  {
    category: 'web_search',
    toolNames: ['prizm_web_search', 'prizm_web_fetch'],
    firstCallHint: [
      '[注意事项]',
      '· 先用 prizm_web_search 搜索，再用 prizm_web_fetch 深入阅读感兴趣的页面',
      '· include_domains/exclude_domains 可缩小搜索范围（如仅搜索官方文档站）',
      '· search_depth: "advanced" 可获得更多高质量结果，但速度较慢'
    ].join('\n')
  }
]

/* ------------------------------------------------------------------ */
/*  索引构建（启动时一次性计算）                                          */
/* ------------------------------------------------------------------ */

/** 工具名 → 所属 category */
const toolToCategoryMap = new Map<string, string>()
/** category → GuideEntry */
const categoryMap = new Map<string, ToolGuide>()

for (const g of GUIDES) {
  categoryMap.set(g.category, g)
  for (const t of g.toolNames) toolToCategoryMap.set(t, g.category)
}

/* ------------------------------------------------------------------ */
/*  Session 级查阅状态追踪                                               */
/* ------------------------------------------------------------------ */

/** sessionId → 已注入过注意事项的 category 集合 */
const sessionConsulted = new Map<string, Set<string>>()

/** 标记某 session 已注入某 category 注意事项 */
export function markGuideConsulted(sessionId: string, category: string): void {
  let cats = sessionConsulted.get(sessionId)
  if (!cats) {
    cats = new Set()
    sessionConsulted.set(sessionId, cats)
  }
  cats.add(category)
}

/** 检查某 session 是否已注入某 category */
export function isGuideConsulted(sessionId: string, category: string): boolean {
  return sessionConsulted.get(sessionId)?.has(category) ?? false
}

/** Session 删除时清除记录（防止内存泄漏） */
export function clearSessionGuides(sessionId: string): void {
  sessionConsulted.delete(sessionId)
}

/* ------------------------------------------------------------------ */
/*  公开 API                                                           */
/* ------------------------------------------------------------------ */

/**
 * 获取工具所属的 guard category（用于首次注入追踪）
 * @returns 所属 category，不在任何组内时返回 null
 */
export function getGuardCategory(toolName: string): string | null {
  return toolToCategoryMap.get(toolName) ?? null
}

/**
 * 获取工具组的首次调用注意事项
 * @returns 注意事项文本，不存在时返回 null
 */
export function getFirstCallHint(toolName: string): string | null {
  const cat = toolToCategoryMap.get(toolName)
  if (!cat) return null
  return categoryMap.get(cat)?.firstCallHint ?? null
}
