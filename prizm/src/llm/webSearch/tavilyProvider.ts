/**
 * Tavily 搜索提供商
 * API: https://api.tavily.com/search + https://api.tavily.com/extract
 */

import { getTavilySettings } from '../../settings/agentToolsStore'
import { createLogger } from '../../logger'
import type {
  WebSearchProvider,
  WebSearchResult,
  WebSearchOptions,
  WebFetchResult,
  WebFetchOptions
} from './types'
import { extractDomain } from './utils'

const log = createLogger('Tavily')

function getApiKey(): string | null {
  const settings = getTavilySettings()
  if (settings?.enabled === false) return null
  return settings?.apiKey?.trim() || process.env.TAVILY_API_KEY?.trim() || null
}

export class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily'

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = getApiKey()
    if (!apiKey) {
      log.warn('Tavily API Key not configured')
      return []
    }

    const settings = getTavilySettings()
    const maxResults = Math.min(10, Math.max(1, options?.maxResults ?? settings?.maxResults ?? 5))
    const searchDepth = options?.searchDepth ?? settings?.searchDepth ?? 'basic'

    const body: Record<string, unknown> = {
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: false,
      include_raw_content: false
    }

    if (options?.includeDomains?.length) {
      body.include_domains = options.includeDomains
    }
    if (options?.excludeDomains?.length) {
      body.exclude_domains = options.excludeDomains
    }

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const errText = await res.text()
        log.error('Tavily search API error:', res.status, errText)
        throw new Error(`Tavily search failed: ${res.status}`)
      }

      const data = (await res.json()) as {
        results?: Array<{
          title?: string
          url?: string
          content?: string
          published_date?: string
        }>
      }

      return (data.results ?? []).map((r) => ({
        title: r.title ?? '(无标题)',
        url: r.url ?? '',
        snippet: r.content ?? '',
        pageAge: r.published_date ?? undefined,
        domain: extractDomain(r.url ?? '')
      }))
    } catch (err) {
      log.error('Tavily search error:', err)
      throw err
    }
  }

  async extract(url: string, options?: WebFetchOptions): Promise<WebFetchResult | null> {
    const apiKey = getApiKey()
    if (!apiKey) {
      log.warn('Tavily API Key not configured, cannot extract')
      return null
    }

    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ urls: [url] })
      })

      if (!res.ok) {
        const errText = await res.text()
        log.error('Tavily extract API error:', res.status, errText)
        return null
      }

      const data = (await res.json()) as {
        results?: Array<{
          url?: string
          raw_content?: string
        }>
      }

      const first = data.results?.[0]
      if (!first?.raw_content) return null

      const maxChars = options?.maxChars ?? 8000
      const totalChars = first.raw_content.length
      const truncated = totalChars > maxChars
      const content = truncated ? first.raw_content.slice(0, maxChars) : first.raw_content

      return {
        url: first.url ?? url,
        title: '',
        content,
        totalChars,
        truncated
      }
    } catch (err) {
      log.error('Tavily extract error:', err)
      return null
    }
  }
}
