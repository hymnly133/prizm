/**
 * 工具使用指南注册表（Tool Guide Registry）
 *
 * "类 Skill" 机制：通过 `prizm_tool_guide` 工具让 LLM 按需查询工具使用说明。
 *
 * 守卫以**工具组**为单位：
 * - 每个 Guide 对应一个工具组（如 terminal 组、lock 组）
 * - `guarded: true` 的组，其内任意工具首次调用均触发拦截
 * - 首次拦截 → 返回完整指南 + 错误，标记组已查阅，LLM 重试
 * - 同一 session 内已查阅 → 放行，执行结果末尾附带精简提示（tips）
 * - 查阅状态以 session 为单位持久化（跨 chat 轮次有效，session 删除时清除）
 */

/* ------------------------------------------------------------------ */
/*  Guide 注册表                                                       */
/* ------------------------------------------------------------------ */

export interface ToolGuide {
  /** 工具组标识 */
  category: string
  /** 组简述（列表展示用） */
  label: string
  /** 组内所有工具名 */
  toolNames: string[]
  /** 是否整组守卫（true = 组内任意工具首次调用都触发） */
  guarded: boolean
  /** 指南完整正文（首次拦截时返回） */
  content: string
  /** 精简提示（已放行后附带到工具结果末尾） */
  tips: string
}

const GUIDES: ToolGuide[] = [
  {
    category: 'terminal',
    label: '终端工具组（execute / spawn / send_keys）',
    toolNames: ['prizm_terminal_execute', 'prizm_terminal_spawn', 'prizm_terminal_send_keys'],
    guarded: true,
    content: [
      '# 终端工具使用指南',
      '',
      '## 工具选择',
      '- 一次性命令（ls/git/npm/pip 等）→ `prizm_terminal_execute`',
      '- 交互/长时间运行（dev server、watch、REPL）→ `prizm_terminal_spawn` 创建 + `prizm_terminal_send_keys` 交互',
      '',
      '## prizm_terminal_send_keys 用法',
      '`pressEnter` 控制是否在 input 后自动按回车（\\r）。**不要**在 input 中手动添加 \\n 或 \\r。',
      '',
      '| 场景 | 调用方式 |',
      '|------|---------|',
      '| 执行命令（最常用） | `{ input: "npm install", pressEnter: true }` (默认 true 可省略) |',
      '| 分步输入再执行 | 步骤1: `{ input: "git commit -m \\"msg\\"", pressEnter: false }` → 步骤2: `{ input: "", pressEnter: true }` |',
      '| 交互式输入（密码/确认） | `{ input: "y", pressEnter: true }` |',
      '| 仅键入不执行（Tab 补全） | `{ input: "cd /usr/lo", pressEnter: false }` |',
      '',
      '## workspace 参数',
      '- `"main"`（默认）→ 全局工作目录（项目构建/依赖安装）',
      '- `"session"` → 会话临时目录（临时脚本/测试）',
      '',
      '## 安全',
      '⚠️ 禁止执行：删除系统文件、修改系统配置、rm -rf / 等危险操作'
    ].join('\n'),
    tips:
      '[提示] 一次性命令用 execute；交互用 spawn+send_keys。' +
      'send_keys: pressEnter 控制回车，不要在 input 中加 \\n/\\r。' +
      '⚠️ 禁止 rm -rf 等危险操作。'
  },
  {
    category: 'lock',
    label: '资源锁工具（prizm_lock）',
    toolNames: ['prizm_lock'],
    guarded: true,
    content: [
      '# 资源锁使用指南（prizm_lock）',
      '',
      '## 文档编辑流程',
      '1. `prizm_lock({ action: "checkout", documentId })` — 获取编辑锁 + 返回文档内容和 fenceToken',
      '2. 使用 `prizm_document({ action: "update", ... })` 修改内容（系统自动验证锁）',
      '3. `prizm_lock({ action: "checkin", documentId })` — 释放锁',
      '',
      '⚠️ 同一文档同时只有一个会话可持有锁。编辑完成后**务必签入**，否则其他会话无法编辑。',
      '',
      '## 待办列表领取流程',
      '1. `prizm_lock({ action: "claim", todoListId })` — 领取列表',
      '2. 使用 `prizm_todo({ action: "update_item", itemId, ... })` / `prizm_lock({ action: "set_active", todoId })` 修改条目',
      '3. `prizm_lock({ action: "release", todoListId })` — 释放',
      '',
      '## 查询资源状态',
      '`prizm_lock({ action: "status", resourceType, resourceId })` — 查看锁定状态、持有者、读取历史'
    ].join('\n'),
    tips: '[提示] 编辑完成后务必 checkin/release 释放锁，否则其他会话无法操作该资源。'
  }
]

/* ------------------------------------------------------------------ */
/*  索引构建（启动时一次性计算）                                          */
/* ------------------------------------------------------------------ */

/** 工具名 → 所属 category */
const toolToCategoryMap = new Map<string, string>()
/** category → GuideEntry */
const categoryMap = new Map<string, ToolGuide>()
/** 被守卫的组集合 */
const guardedCategories = new Set<string>()

for (const g of GUIDES) {
  categoryMap.set(g.category, g)
  for (const t of g.toolNames) toolToCategoryMap.set(t, g.category)
  if (g.guarded) guardedCategories.add(g.category)
}

/* ------------------------------------------------------------------ */
/*  Session 级查阅状态追踪                                               */
/* ------------------------------------------------------------------ */

/** sessionId → 已查阅的 category 集合 */
const sessionConsulted = new Map<string, Set<string>>()

/** 标记某 session 已查阅某 category 指南 */
export function markGuideConsulted(sessionId: string, category: string): void {
  let cats = sessionConsulted.get(sessionId)
  if (!cats) {
    cats = new Set()
    sessionConsulted.set(sessionId, cats)
  }
  cats.add(category)
}

/** 检查某 session 是否已查阅某 category */
export function isGuideConsulted(sessionId: string, category: string): boolean {
  return sessionConsulted.get(sessionId)?.has(category) ?? false
}

/** Session 删除时清除查阅记录（防止内存泄漏） */
export function clearSessionGuides(sessionId: string): void {
  sessionConsulted.delete(sessionId)
}

/* ------------------------------------------------------------------ */
/*  公开 API                                                           */
/* ------------------------------------------------------------------ */

/**
 * 查询工具使用指南（支持工具名或类别名）
 * @returns 指南内容，不存在时返回 null
 */
export function lookupToolGuide(
  toolNameOrCategory: string
): { category: string; content: string } | null {
  const cat = categoryMap.get(toolNameOrCategory)
  if (cat) return { category: cat.category, content: cat.content }

  const mapped = toolToCategoryMap.get(toolNameOrCategory)
  if (mapped) {
    const g = categoryMap.get(mapped)!
    return { category: g.category, content: g.content }
  }

  return null
}

/**
 * 列出所有可用的指南摘要
 */
export function listToolGuides(): Array<{ category: string; label: string; tools: string[] }> {
  return GUIDES.map((g) => ({
    category: g.category,
    label: g.label,
    tools: g.toolNames
  }))
}

/**
 * 检查工具是否属于被守卫的组
 * @returns 所属 category（用于追踪），不在守卫组内时返回 null
 */
export function getGuardCategory(toolName: string): string | null {
  const cat = toolToCategoryMap.get(toolName)
  if (!cat) return null
  return guardedCategories.has(cat) ? cat : null
}

/**
 * 获取工具的精简提示（已放行后附带到执行结果末尾）
 * 仅守卫组内的工具返回 tips
 */
export function getToolTips(toolName: string): string | null {
  const cat = toolToCategoryMap.get(toolName)
  if (!cat || !guardedCategories.has(cat)) return null
  return categoryMap.get(cat)?.tips ?? null
}

/**
 * 获取所有被守卫的工具组名（用于 prizm_tool_guide 工具描述）
 */
export function getGuardedGroupNames(): string[] {
  return [...guardedCategories]
}

/** 守卫拦截时的错误码，便于前端/日志识别 */
export const GUIDE_NOT_CONSULTED_CODE = 'GUIDE_NOT_CONSULTED'
