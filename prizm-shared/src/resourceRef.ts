/**
 * 全局资源引用路径系统 — 类型定义与 URI 工具函数
 *
 * URI 格式：[scope:]type:id
 * 短格式：type:id（默认当前 scope）
 * 完整格式：scope:type:id（跨 scope 引用）
 */

/** 所有可引用的资源类型 */
export type ResourceType =
  | 'doc'
  | 'todo'
  | 'file'
  | 'workflow'
  | 'run'
  | 'task'
  | 'session'
  | 'schedule'
  | 'cron'
  | 'memory'

/** 资源类型元数据 */
export interface ResourceTypeMeta {
  type: ResourceType
  label: string
  /** Lucide 图标名称 */
  icon: string
  /** 是否可列出（false 表示仅按 ID 解析） */
  listable: boolean
  /** 中文别名，用于 @引用 */
  aliases?: string[]
}

/** 全量资源类型元数据 */
export const RESOURCE_TYPE_META: Record<ResourceType, ResourceTypeMeta> = {
  doc: { type: 'doc', label: '文档', icon: 'FileText', listable: true, aliases: ['文档', 'note', '便签'] },
  todo: { type: 'todo', label: '待办', icon: 'CheckSquare', listable: true, aliases: ['待办'] },
  file: { type: 'file', label: '文件', icon: 'File', listable: false, aliases: ['文件'] },
  workflow: { type: 'workflow', label: '工作流', icon: 'Blocks', listable: true, aliases: ['工作流'] },
  run: { type: 'run', label: '运行', icon: 'GitBranch', listable: true, aliases: ['运行', '工作流运行'] },
  task: { type: 'task', label: '任务', icon: 'Zap', listable: true, aliases: ['任务'] },
  session: { type: 'session', label: '会话', icon: 'MessageSquare', listable: true, aliases: ['会话'] },
  schedule: { type: 'schedule', label: '日程', icon: 'Calendar', listable: true, aliases: ['日程'] },
  cron: { type: 'cron', label: '定时任务', icon: 'Clock', listable: true, aliases: ['定时', '定时任务'] },
  memory: { type: 'memory', label: '记忆', icon: 'Brain', listable: false, aliases: ['记忆'] }
}

/** 所有资源类型 key 集合 */
export const ALL_RESOURCE_TYPES: ResourceType[] = Object.keys(RESOURCE_TYPE_META) as ResourceType[]

/** 可列出的资源类型 */
export const LISTABLE_RESOURCE_TYPES: ResourceType[] = ALL_RESOURCE_TYPES.filter(
  (t) => RESOURCE_TYPE_META[t].listable
)

/** 解析后的资源 URI */
export interface ResourceURI {
  /** scope 名称，省略时使用当前 scope */
  scope?: string
  /** 资源类型 */
  type: ResourceType
  /** 资源 ID */
  id: string
}

const VALID_TYPES = new Set<string>(ALL_RESOURCE_TYPES)

/**
 * 将 ResourceURI 格式化为字符串
 * - 有 scope 时输出 `scope:type:id`
 * - 无 scope 时输出 `type:id`
 */
export function formatResourceURI(uri: ResourceURI): string {
  if (uri.scope) return `${uri.scope}:${uri.type}:${uri.id}`
  return `${uri.type}:${uri.id}`
}

/**
 * 从字符串解析 ResourceURI
 * 支持两种格式：
 * - `type:id`（短格式）
 * - `scope:type:id`（跨 scope 格式）
 *
 * @returns 解析成功返回 ResourceURI，失败返回 null
 */
export function parseResourceURI(raw: string): ResourceURI | null {
  if (!raw || typeof raw !== 'string') return null
  const parts = raw.split(':')

  if (parts.length === 2) {
    const [type, id] = parts
    if (!type || !id) return null
    if (!VALID_TYPES.has(type)) return null
    return { type: type as ResourceType, id }
  }

  if (parts.length >= 3) {
    const [first, second, ...rest] = parts
    // Try scope:type:id (second segment is a valid type)
    if (VALID_TYPES.has(second!) && first && rest.length > 0) {
      return { scope: first, type: second as ResourceType, id: rest.join(':') }
    }
    // Try type:id where id contains colons (e.g. file:C:/path)
    if (VALID_TYPES.has(first!) && second) {
      return { type: first as ResourceType, id: [second, ...rest].join(':') }
    }
  }

  return null
}

/**
 * 判断字符串是否为合法的 ResourceType
 */
export function isResourceType(value: string): value is ResourceType {
  return VALID_TYPES.has(value)
}

/**
 * 从别名或类型 key 解析到规范化的 ResourceType
 * @returns 匹配到的 ResourceType，未匹配返回 null
 */
export function resolveResourceType(keyOrAlias: string): ResourceType | null {
  const lower = keyOrAlias.toLowerCase()
  if (VALID_TYPES.has(lower)) return lower as ResourceType
  for (const meta of Object.values(RESOURCE_TYPE_META)) {
    if (meta.aliases?.some((a) => a.toLowerCase() === lower)) return meta.type
  }
  return null
}
