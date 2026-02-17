/**
 * MCP Layer 0: File system tools (list, read, write, move, delete)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as mdStore from '../../core/mdStore'

export function registerFileTools(server: McpServer, scopeRoot: string): void {
  server.registerTool(
    'prizm_file_list',
    {
      description: '列出工作区目录内容',
      inputSchema: z.object({
        path: z.string().optional().default('').describe('相对路径，空字符串表示根目录'),
        recursive: z.boolean().optional().default(false).describe('是否递归列出子目录')
      })
    },
    async ({ path: dirPath, recursive }) => {
      const entries = mdStore.listDirectory(scopeRoot, dirPath ?? '', { recursive })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_file_read',
    {
      description: '读取工作区中的文件',
      inputSchema: z.object({
        path: z.string().describe('相对路径')
      })
    },
    async ({ path: filePath }) => {
      const result = mdStore.readFileByPath(scopeRoot, filePath)
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: `File not found: ${filePath}` }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
      }
    }
  )

  server.registerTool(
    'prizm_file_write',
    {
      description: '写入文件到工作区',
      inputSchema: z.object({
        path: z.string().describe('相对路径'),
        content: z.string().describe('文件内容')
      })
    },
    async ({ path: filePath, content }) => {
      if (mdStore.isSystemPath(filePath)) {
        return {
          content: [{ type: 'text' as const, text: 'Cannot write to system directory' }],
          isError: true
        }
      }
      const ok = mdStore.writeFileByPath(scopeRoot, filePath, content)
      if (!ok) {
        return {
          content: [{ type: 'text' as const, text: 'Failed to write file' }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text' as const, text: `Written: ${filePath}` }]
      }
    }
  )

  server.registerTool(
    'prizm_file_move',
    {
      description: '移动/重命名工作区中的文件',
      inputSchema: z.object({
        from: z.string().describe('源路径'),
        to: z.string().describe('目标路径')
      })
    },
    async ({ from, to }) => {
      if (mdStore.isSystemPath(from) || mdStore.isSystemPath(to)) {
        return {
          content: [{ type: 'text' as const, text: 'Cannot move system files' }],
          isError: true
        }
      }
      const ok = mdStore.moveFile(scopeRoot, from, to)
      if (!ok) {
        return {
          content: [{ type: 'text' as const, text: `Source not found: ${from}` }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text' as const, text: `Moved: ${from} -> ${to}` }]
      }
    }
  )

  server.registerTool(
    'prizm_file_delete',
    {
      description: '删除工作区中的文件或目录',
      inputSchema: z.object({
        path: z.string().describe('相对路径')
      })
    },
    async ({ path: filePath }) => {
      if (mdStore.isSystemPath(filePath)) {
        return {
          content: [{ type: 'text' as const, text: 'Cannot delete system files' }],
          isError: true
        }
      }
      const ok = mdStore.deleteByPath(scopeRoot, filePath)
      if (!ok) {
        return {
          content: [{ type: 'text' as const, text: `File not found: ${filePath}` }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text' as const, text: `Deleted: ${filePath}` }]
      }
    }
  )
}
