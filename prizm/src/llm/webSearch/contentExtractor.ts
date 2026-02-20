/**
 * URL 内容抓取与正文提取
 * 先尝试 Tavily Extract API，降级到直接 fetch + 简易提取
 */

import { createLogger } from '../../logger'
import type { WebFetchResult, WebFetchOptions, WebSearchProvider } from './types'
import { extractDomain } from './utils'

const log = createLogger('ContentExtractor')

const DEFAULT_MAX_CHARS = 8000
const FETCH_TIMEOUT_MS = 15_000

const BLOCK_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'iframe', 'object',
  'embed', 'applet', 'nav', 'footer', 'header'
])

/** 从 HTML 中提取可读文本（简易实现，不依赖外部库） */
function htmlToText(html: string): string {
  let text = html

  for (const tag of BLOCK_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
    text = text.replace(regex, '')
  }

  text = text.replace(/<[^>]+>/g, ' ')

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&[a-zA-Z]+;/g, ' ')

  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  return text
}

/** 从 HTML 提取 <title> */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m?.[1]?.trim() ?? ''
}

/**
 * 抓取 URL 内容。
 * 优先使用 provider 的 extract 方法（如 Tavily Extract），降级到直接 fetch。
 */
export async function fetchUrlContent(
  url: string,
  options?: WebFetchOptions,
  provider?: WebSearchProvider
): Promise<WebFetchResult> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS

  if (provider?.extract) {
    try {
      const result = await provider.extract(url, options)
      if (result && result.content) return result
    } catch (err) {
      log.warn('Provider extract failed, falling back to direct fetch:', err)
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PrizmBot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal,
      redirect: 'follow'
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      const jsonText = await res.text()
      const totalChars = jsonText.length
      const truncated = totalChars > maxChars
      return {
        url,
        title: extractDomain(url),
        content: truncated ? jsonText.slice(0, maxChars) : jsonText,
        totalChars,
        truncated
      }
    }

    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return {
        url,
        title: '',
        content: `不支持的内容类型: ${contentType}`,
        totalChars: 0,
        truncated: false
      }
    }

    const html = await res.text()
    const title = extractTitle(html)
    const text = htmlToText(html)

    const totalChars = text.length
    const truncated = totalChars > maxChars
    const content = truncated ? text.slice(0, maxChars) : text

    return { url, title, content, totalChars, truncated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('URL fetch error:', url, msg)
    return {
      url,
      title: '',
      content: `抓取失败: ${msg}`,
      totalChars: 0,
      truncated: false
    }
  } finally {
    clearTimeout(timeout)
  }
}
