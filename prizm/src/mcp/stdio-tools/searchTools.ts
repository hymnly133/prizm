/**
 * MCP stdio tools: Prizm unified search and note search
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export interface SearchToolsOptions {
  baseUrl: string
  apiKey: string
  scope: string
}

/**
 * Registers search tools. prizm_search uses POST /search with custom body (keywords, types, limit, mode, fuzzy);
 * the fetcher injects scope into body, so we use fetchPrizm for consistency. For POST /search the server
 * expects body with keywords, scope, types, limit, mode, fuzzy - fetcher adds scope, so we pass the rest.
 */
export function registerSearchTools(
  server: McpServer,
  fetchPrizm: PrizmFetcher,
  options: SearchToolsOptions
): void {
  const { baseUrl, apiKey, scope } = options
  const base = baseUrl.replace(/\/+$/, '')

  server.registerTool(
    'prizm_search',
    {
      description:
        '统一关键词搜索：在便签、文档、剪贴板、待办中按关键词匹配。默认模糊搜索，支持拼写容错。输入关键词（支持空格/逗号分隔，自动分词），返回按相关性排序的结果。',
      inputSchema: z.object({
        keywords: z
          .union([z.string(), z.array(z.string())])
          .describe('关键词，支持字符串（自动分词）或关键词数组'),
        types: z
          .array(z.enum(['note', 'document', 'clipboard', 'todoList']))
          .optional()
          .describe('限定搜索类型，不传则搜索全部'),
        limit: z.number().optional().describe('最大返回数，默认 50'),
        mode: z
          .enum(['any', 'all'])
          .optional()
          .describe('any=任一关键词命中，all=需全部命中，默认 any'),
        fuzzy: z.number().min(0).max(1).optional().describe('模糊程度 0~1，默认 0.2；0 关闭模糊')
      })
    },
    async ({ keywords, types, limit, mode, fuzzy }) => {
      const url = `${base}/search${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { Authorization: `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          keywords,
          scope,
          types,
          limit: limit ?? 50,
          mode: mode ?? 'any',
          fuzzy
        })
      })
      if (!res.ok) throw new Error(`Prizm search error: ${res.status} ${await res.text()}`)
      const data = (await res.json()) as {
        results: Array<{
          kind: string
          id: string
          score: number
          matchedKeywords: string[]
          preview: string
          raw: unknown
        }>
      }
      const summary = data.results.map((r) => ({
        kind: r.kind,
        id: r.id,
        score: r.score,
        matched: r.matchedKeywords,
        preview: r.preview
      }))
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ total: data.results.length, results: summary }, null, 2)
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_search_notes',
    {
      description: '按关键词搜索 Prizm 便签内容（仅便签，建议优先使用 prizm_search 统一搜索）',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词')
      })
    },
    async ({ query }) => {
      const data = (await fetchPrizm(`/notes?q=${encodeURIComponent(query)}`)) as {
        notes: Array<{ id: string; content: string; createdAt: number }>
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.notes, null, 2)
          }
        ]
      }
    }
  )
}
