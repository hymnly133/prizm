/**
 * 联网搜索服务：统一入口 + 结果格式化
 */

import { createLogger } from '../../logger'
import { TavilyProvider } from './tavilyProvider'
import { fetchUrlContent } from './contentExtractor'
import type {
  WebSearchProvider,
  WebSearchResult,
  WebSearchOptions,
  WebFetchResult,
  WebFetchOptions
} from './types'

const log = createLogger('WebSearch')

let _provider: WebSearchProvider | null = null

/** 获取当前激活的搜索提供商（惰性初始化） */
export function getActiveProvider(): WebSearchProvider {
  if (!_provider) {
    _provider = new TavilyProvider()
  }
  return _provider
}

/** 允许外部替换提供商（如切换到 Brave） */
export function setProvider(provider: WebSearchProvider): void {
  _provider = provider
  log.info('Web search provider set to:', provider.name)
}

/** 执行联网搜索 */
export async function webSearch(
  query: string,
  options?: WebSearchOptions
): Promise<WebSearchResult[]> {
  const provider = getActiveProvider()
  return provider.search(query, options)
}

/** 抓取 URL 内容 */
export async function webFetch(
  url: string,
  options?: WebFetchOptions
): Promise<WebFetchResult> {
  const provider = getActiveProvider()
  return fetchUrlContent(url, options, provider)
}

/** 将搜索结果格式化为 LLM 友好的文本 */
export function formatSearchResults(results: WebSearchResult[]): string {
  if (!results.length) return '未找到相关结果。'

  const lines = results.map((r, i) => {
    const idx = i + 1
    const age = r.pageAge ? `, ${r.pageAge}` : ''
    const domain = r.domain || '未知来源'
    return `[${idx}] **${r.title}** (${domain}${age})\nURL: ${r.url}\n${r.snippet}`
  })

  return [
    `找到 ${results.length} 条结果：\n`,
    lines.join('\n\n'),
    '\n\n> 提示：使用 prizm_web_fetch 可深入阅读任意链接的完整内容。'
  ].join('')
}

/** 将抓取结果格式化为 LLM 友好的文本 */
export function formatFetchResult(result: WebFetchResult): string {
  const titleLine = result.title ? `# ${result.title}\n\n` : ''
  const truncNote = result.truncated
    ? `\n\n---\n（内容已截断，原文共 ${result.totalChars} 字）`
    : ''
  return `${titleLine}来源: ${result.url}\n\n${result.content}${truncNote}`
}
