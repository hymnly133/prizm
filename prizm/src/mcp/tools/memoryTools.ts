/**
 * MCP Memory tools (list memories, search memories)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  isMemoryEnabled,
  getAllMemories,
  searchMemoriesWithOptions
} from '../../llm/EverMemService'

export function registerMemoryTools(server: McpServer, scope: string): void {
  server.registerTool(
    'prizm_list_memories',
    {
      description: '列出当前 scope 下与对话相关的长期记忆条目',
      inputSchema: z.object({})
    },
    async () => {
      if (!isMemoryEnabled()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ enabled: false, memories: [] }, null, 2)
            }
          ],
          isError: false
        }
      }
      const memories = await getAllMemories(scope)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: true,
                memories: memories.map((m) => ({
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
      if (!isMemoryEnabled()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ enabled: false, memories: [] }, null, 2)
            }
          ],
          isError: false
        }
      }
      const q = (query ?? '').trim()
      if (!q) {
        return {
          content: [{ type: 'text' as const, text: 'query is required' }],
          isError: true
        }
      }
      const memories = await searchMemoriesWithOptions(q, scope)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                enabled: true,
                memories: memories.map((m) => ({
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
