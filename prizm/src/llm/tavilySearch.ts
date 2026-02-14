/**
 * Tavily 联网搜索
 * API: https://api.tavily.com/search
 */

import { getTavilySettings } from '../settings/agentToolsStore'
import { createLogger } from '../logger'

const log = createLogger('Tavily')

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

/**
 * 执行 Tavily 搜索
 * API Key 优先从 settings 读取，其次环境变量 TAVILY_API_KEY
 */
export async function searchTavily(
  query: string,
  options?: { maxResults?: number; searchDepth?: string }
): Promise<TavilySearchResult[]> {
  const settings = getTavilySettings()
  const apiKey = settings?.apiKey?.trim() || process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) {
    log.warn('Tavily API Key not configured')
    return []
  }
  if (settings?.enabled === false) {
    return []
  }

  const maxResults = options?.maxResults ?? settings?.maxResults ?? 5
  const searchDepth = options?.searchDepth ?? settings?.searchDepth ?? 'basic'

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query,
        max_results: Math.min(20, Math.max(1, maxResults)),
        search_depth: searchDepth,
        include_answer: false,
        include_raw_content: false
      })
    })

    if (!res.ok) {
      const errText = await res.text()
      log.error('Tavily API error:', res.status, errText)
      throw new Error(`Tavily search failed: ${res.status}`)
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>
    }
    const results = data.results ?? []
    return results.map((r) => ({
      title: r.title ?? '(无标题)',
      url: r.url ?? '',
      content: r.content ?? ''
    }))
  } catch (err) {
    log.error('Tavily search error:', err)
    throw err
  }
}
