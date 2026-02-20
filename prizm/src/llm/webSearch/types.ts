/**
 * 联网搜索模块类型定义
 */

/** 搜索结果条目 */
export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  /** 页面更新时间（如 "2025-02-19"） */
  pageAge?: string
  /** 提取的域名（如 "example.com"） */
  domain: string
}

/** 页面抓取结果 */
export interface WebFetchResult {
  url: string
  title: string
  /** Markdown 格式的正文内容 */
  content: string
  /** 原始内容总字数（截断前） */
  totalChars: number
  /** 是否被截断 */
  truncated: boolean
}

/** 搜索选项 */
export interface WebSearchOptions {
  /** 搜索深度 */
  searchDepth?: 'basic' | 'advanced'
  /** 最大结果数 (1-10) */
  maxResults?: number
  /** 仅搜索这些域名 */
  includeDomains?: string[]
  /** 排除这些域名 */
  excludeDomains?: string[]
}

/** 抓取选项 */
export interface WebFetchOptions {
  /** 全文 or 摘要 */
  extractMode?: 'full' | 'summary'
  /** 最大返回字数，默认 8000 */
  maxChars?: number
}

/** 搜索提供商接口 */
export interface WebSearchProvider {
  readonly name: string
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>
  /** 提取指定 URL 的页面正文（可选实现） */
  extract?(url: string, options?: WebFetchOptions): Promise<WebFetchResult | null>
}
