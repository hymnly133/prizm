/**
 * 联网搜索工具函数
 */

/** 从 URL 提取域名 */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
