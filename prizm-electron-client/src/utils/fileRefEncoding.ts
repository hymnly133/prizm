/**
 * 文件路径引用编码/解码工具
 *
 * 在 @(file:path) 引用格式中，路径可能包含 `)` 等特殊字符。
 * 对 `)` 进行编码以确保不破坏 chip 正则匹配 @([^)]+)。
 */

/** 将文件路径编码为引用安全的格式（仅编码 `)` 字符） */
export function encodeFilePathForRef(path: string): string {
  return path.replace(/\)/g, '%29')
}

/** 从引用中解码文件路径 */
export function decodeFilePathFromRef(encoded: string): string {
  return encoded.replace(/%29/g, ')')
}

/** 从 @(file:path) 格式的引用 inner 内容中提取文件名 */
export function extractFileNameFromPath(filePath: string): string {
  const decoded = decodeFilePathFromRef(filePath)
  const sep = decoded.includes('\\') ? '\\' : '/'
  const parts = decoded.split(sep)
  return parts[parts.length - 1] || decoded
}
