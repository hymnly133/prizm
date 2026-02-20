/**
 * 默认权限规则 — 从 workspaceResolver / interactManager 行为迁移而来
 *
 * 定义了写操作类工具在 default 模式下需要 ask 的规则。
 */

import type { PermissionRule } from './types'

/** 文件写操作工具 — default 模式下需要 ask */
const FILE_WRITE_TOOLS: PermissionRule[] = [
  'prizm_write_file',
  'prizm_move_file',
  'prizm_delete_file'
].map((tool, i) => ({
  id: `default:file-write:${tool}`,
  toolPattern: tool,
  behavior: 'ask' as const,
  priority: 50 + i
}))

/** 终端执行工具 — default 模式下需要 ask */
const TERMINAL_TOOLS: PermissionRule[] = [
  {
    id: 'default:terminal',
    toolPattern: 'prizm_terminal_*',
    behavior: 'ask' as const,
    priority: 55
  }
]

/** plan 模式专用：拒绝所有写操作 */
const PLAN_MODE_DENY_TOOLS: PermissionRule[] = [
  {
    id: 'plan:deny-write',
    toolPattern: 'prizm_write_file',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: write operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-move',
    toolPattern: 'prizm_move_file',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: file move operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-delete-file',
    toolPattern: 'prizm_delete_file',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: file delete operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-update-doc',
    toolPattern: 'prizm_update_document',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: document update operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-create-doc',
    toolPattern: 'prizm_create_document',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: document create operations are not allowed',
    priority: 10
  },
  {
    id: 'plan:deny-terminal',
    toolPattern: 'prizm_terminal_*',
    behavior: 'deny' as const,
    denyMessage: 'Plan mode: terminal operations are not allowed',
    priority: 10
  }
]

/** 获取指定模式的默认规则集 */
export function getDefaultRules(mode: string): PermissionRule[] {
  switch (mode) {
    case 'plan':
      return [...PLAN_MODE_DENY_TOOLS]
    case 'default':
      return [...FILE_WRITE_TOOLS, ...TERMINAL_TOOLS]
    case 'acceptEdits':
    case 'bypassPermissions':
      return []
    case 'dontAsk':
      return [
        ...FILE_WRITE_TOOLS.map((r) => ({
          ...r,
          behavior: 'deny' as const,
          denyMessage: 'dontAsk mode: operation requires approval but auto-deny is enabled'
        })),
        ...TERMINAL_TOOLS.map((r) => ({
          ...r,
          behavior: 'deny' as const,
          denyMessage: 'dontAsk mode: terminal operations auto-denied'
        }))
      ]
    default:
      return []
  }
}
