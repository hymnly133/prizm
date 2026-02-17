/**
 * MCP stdio tools: Prizm long-term memory (list and search via HTTP API)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { PrizmFetcher } from './fetcher.js'

export function registerMemoryTools(server: McpServer, fetchPrizm: PrizmFetcher): void {
  server.registerTool(
    'prizm_list_memories',
    {
      description: '列出当前 scope 下与对话相关的长期记忆条目',
      inputSchema: z.object({})
    },
    async () => {
      const data = (await fetchPrizm('/agent/memories')) as {
        enabled: boolean
        memories: Array<{
          id: string
          memory: unknown
          created_at?: number
          updated_at?: number
        }>
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: data.enabled ?? false,
                memories: (data.memories ?? []).map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  created_at: m.created_at,
                  updated_at: m.updated_at
                }))
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.registerTool(
    'prizm_search_memories',
    {
      description: '按语义/关键词搜索用户记忆，用于回忆过往对话或偏好',
      inputSchema: z.object({
        query: z.string().describe('搜索问题或关键词')
      })
    },
    async ({ query }) => {
      const q = (query ?? '').trim()
      if (!q) {
        return {
          content: [{ type: 'text' as const, text: 'query is required' }],
          isError: true
        }
      }
      const data = (await fetchPrizm('/agent/memories/search', {
        method: 'POST',
        body: JSON.stringify({ query: q })
      })) as {
        enabled: boolean
        memories: Array<{
          id: string
          memory: unknown
          created_at?: number
          score?: number
        }>
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: data.enabled ?? false,
                memories: (data.memories ?? []).map((m) => ({
                  id: m.id,
                  memory: m.memory,
                  created_at: m.created_at,
                  ...(typeof (m as { score?: number }).score === 'number'
                    ? { score: (m as { score?: number }).score }
                    : {})
                }))
              },
              null,
              2
            )
          }
        ]
      }
    }
  )
}
