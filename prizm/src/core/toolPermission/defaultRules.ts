/**
 * 默认权限规则 — 复合工具 (prizm_file, prizm_document 等) 版本
 *
 * 使用 toolPattern + actionFilter 匹配复合工具的写操作 action。
 */

import type { PermissionRule } from './types'

/** 文件写操作 — prizm_file action: write/move/delete */
const FILE_WRITE_RULES: PermissionRule[] = [
  {
    id: 'default:file-write',
    toolPattern: 'prizm_file',
    actionFilter: ['write', 'move', 'delete'],
    behavior: 'ask' as const,
    priority: 50
  }
]

/** 终端执行工具 */
const TERMINAL_RULES: PermissionRule[] = [
  {
    id: 'default:terminal',
    toolPattern: 'prizm_terminal_*',
    behavior: 'ask' as const,
    priority: 55
  }
]

/** 文档写操作 — prizm_document action: create/update/delete */
const DOCUMENT_WRITE_RULES: PermissionRule[] = [
  {
    id: 'default:doc-write',
    toolPattern: 'prizm_document',
    actionFilter: ['create', 'update', 'delete'],
    behavior: 'ask' as const,
    priority: 52
  }
]

/** 定时任务写操作 — prizm_cron action: create/delete */
const CRON_WRITE_RULES: PermissionRule[] = [
  {
    id: 'default:cron-write',
    toolPattern: 'prizm_cron',
    actionFilter: ['create', 'delete'],
    behavior: 'ask' as const,
    priority: 54
  }
]

/** default 模式全部 ask 规则 */
const DEFAULT_ASK_RULES: PermissionRule[] = [
  ...FILE_WRITE_RULES,
  ...DOCUMENT_WRITE_RULES,
  ...CRON_WRITE_RULES,
  ...TERMINAL_RULES
]

/** plan 模式专用：拒绝所有写操作 */
const PLAN_MODE_DENY_RULES: PermissionRule[] = [
  {
    id: 'plan:deny-file-write',
    toolPattern: 'prizm_file',
    actionFilter: ['write', 'move', 'delete'],
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: file write operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-doc-write',
    toolPattern: 'prizm_document',
    actionFilter: ['create', 'update', 'delete'],
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: document write operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-terminal',
    toolPattern: 'prizm_terminal_*',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: terminal operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-cron-write',
    toolPattern: 'prizm_cron',
    actionFilter: ['create', 'delete'],
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: cron write operations are not allowed',
    priority: 10
  }
]

/** 获取指定模式的默认规则集 */
export function getDefaultRules(mode: string): PermissionRule[] {
  switch (mode) {
    case 'plan':
      return [...PLAN_MODE_DENY_RULES]
    case 'default':
      return [...DEFAULT_ASK_RULES]
    case 'acceptEdits':
    case 'bypassPermissions':
      return []
    case 'dontAsk':
      return DEFAULT_ASK_RULES.map((r) => ({
        ...r,
        id: r.id.replace('default:', 'dontAsk:'),
        behavior: 'deny' as const,
        denyMessage: `dontAsk mode: ${r.toolPattern} operation auto-denied`
      }))
    default:
      return []
  }
}
