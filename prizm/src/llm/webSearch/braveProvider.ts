/**
 * Brave Search 提供商
 * API: https://api.search.brave.com/res/v1/web/search
 *
 * 需要 BRAVE_SEARCH_API_KEY 环境变量或 settings 配置
 */

import { createLogger } from '../../logger'
import type {
  WebSearchProvider,
  WebSearchResult,
  WebSearchOptions
} from './types'
import { extractDomain } from './utils'

const log = createLogger('BraveSearch')

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search'

function getApiKey(): string | null {
  return process.env.BRAVE_SEARCH_API_KEY?.trim() || null
}

export class BraveProvider implements WebSearchProvider {
  readonly name = 'brave'

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = getApiKey()
    if (!apiKey) {
      log.warn('Brave Search API Key not configured')
      return []
    }

    const maxResults = Math.min(10, Math.max(1, options?.maxResults ?? 5))

    const params = new URLSearchParams({
      q: query,
      count: String(maxResults)
    })

    try {
      const res = await fetch(`${BRAVE_API_URL}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey
        }
      })

      if (!res.ok) {
        const errText = await res.text()
        log.error('Brave Search API error:', res.status, errText)
        throw new Error(`Brave search failed: ${res.status}`)
      }

      const data = (await res.json()) as {
        web?: {
          results?: Array<{
            title?: string
            url?: string
            description?: string
            page_age?: string
          }>
        }
      }

      const results = data.web?.results ?? []

      let filtered = results
      if (options?.includeDomains?.length) {
        const domains = new Set(options.includeDomains.map((d) => d.toLowerCase()))
        filtered = filtered.filter((r) => {
          const d = extractDomain(r.url ?? '').toLowerCase()
          return domains.has(d) || [...domains].some((ad) => d.endsWith(`.${ad}`))
        })
      }
      if (options?.excludeDomains?.length) {
        const domains = new Set(options.excludeDomains.map((d) => d.toLowerCase()))
        filtered = filtered.filter((r) => {
          const d = extractDomain(r.url ?? '').toLowerCase()
          return !domains.has(d) && ![...domains].some((ad) => d.endsWith(`.${ad}`))
        })
      }

      return filtered.map((r) => ({
        title: r.title ?? '(无标题)',
        url: r.url ?? '',
        snippet: r.description ?? '',
        pageAge: r.page_age ?? undefined,
        domain: extractDomain(r.url ?? '')
      }))
    } catch (err) {
      log.error('Brave search error:', err)
      throw err
    }
  }
}
