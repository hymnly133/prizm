/** IPC 返回的文件读取结果 */
export interface ReadFileResult {
  path: string
  name: string
  size: number
  /** null 表示二进制/不支持的文件 */
  content: string | null
  ext: string
  unsupported?: boolean
  truncated?: boolean
}

/** 导入项状态 */
export type ImportItemStatus = 'pending' | 'importing' | 'done' | 'error' | 'ai-sent'

/** 导入项（UI 状态） */
export interface ImportItem {
  /** 唯一标识，用于列表 key / 状态更新 */
  id: string
  /** 来源类型 */
  type: 'text' | 'file'
  /** 文件名或 "导入文本" */
  name: string
  /** 文本内容，null 表示不支持 */
  content: string | null
  /** 文件绝对路径（仅 type=file 时有值） */
  path?: string
  size?: number
  ext?: string
  unsupported?: boolean
  truncated?: boolean
  status: ImportItemStatus
  /** 错误信息 */
  errorMessage?: string
}

/** 从 ReadFileResult 创建 ImportItem */
export function fileResultToImportItem(result: ReadFileResult): ImportItem {
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: 'file',
    name: result.name,
    content: result.content,
    path: result.path,
    size: result.size,
    ext: result.ext,
    unsupported: result.unsupported,
    truncated: result.truncated,
    status: 'pending'
  }
}

/** 从纯文本创建 ImportItem */
export function textToImportItem(text: string): ImportItem {
  return {
    id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: 'text',
    name: '导入文本',
    content: text,
    size: new Blob([text]).size,
    status: 'pending'
  }
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
