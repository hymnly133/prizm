/**
 * 自定义命令 CRUD API
 * 管理 .prizm-data/commands/ 中的 Markdown 命令文件
 * 支持从 Cursor (.cursor/commands/) 和 Claude Code (.claude/commands/) 导入
 */

import type { Router, Request, Response } from 'express'
import { ensureStringParam } from '../scopeUtils'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  loadAllCustomCommands,
  getCustomCommand,
  saveCustomCommand,
  deleteCustomCommand,
  importCommandsFromDir,
  discoverImportableSources,
  type CustomCommandConfig
} from '../llm/customCommandLoader'

const log = createLogger('Commands')

export function createCommandsRoutes(router: Router): void {
  // GET /commands - 列出所有自定义命令
  router.get('/commands', (_req: Request, res: Response) => {
    try {
      const commands = loadAllCustomCommands()
      res.json({ commands })
    } catch (error) {
      log.error('list commands error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /commands - 创建命令
  router.post('/commands', (req: Request, res: Response) => {
    try {
      const b = req.body
      if (!b || typeof b !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }

      const id =
        typeof b.id === 'string' && b.id.trim()
          ? b.id
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-')
          : null
      if (!id) {
        return res.status(400).json({ error: 'id is required (kebab-case)' })
      }

      const existing = getCustomCommand(id)
      if (existing) {
        return res.status(409).json({ error: `Command "${id}" already exists` })
      }

      const config: CustomCommandConfig = {
        id,
        name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : id,
        description: typeof b.description === 'string' ? b.description : undefined,
        mode: b.mode === 'action' ? 'action' : 'prompt',
        aliases: Array.isArray(b.aliases)
          ? b.aliases.filter((s: unknown) => typeof s === 'string')
          : undefined,
        allowedTools: Array.isArray(b.allowedTools)
          ? b.allowedTools.filter((s: unknown) => typeof s === 'string')
          : undefined,
        content: typeof b.content === 'string' ? b.content : '',
        source: 'prizm',
        enabled: b.enabled !== false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      saveCustomCommand(config)
      res.status(201).json(config)
    } catch (error) {
      log.error('create command error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /commands/:id - 获取命令详情
  router.get('/commands/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const cmd = getCustomCommand(id)
      if (!cmd) {
        return res.status(404).json({ error: 'Command not found' })
      }
      res.json(cmd)
    } catch (error) {
      log.error('get command error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // PATCH /commands/:id - 更新命令
  router.patch('/commands/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const existing = getCustomCommand(id)
      if (!existing) {
        return res.status(404).json({ error: 'Command not found' })
      }

      const b = req.body ?? {}
      const updated: CustomCommandConfig = {
        ...existing,
        name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : existing.name,
        description: b.description !== undefined ? b.description : existing.description,
        mode: b.mode === 'action' || b.mode === 'prompt' ? b.mode : existing.mode,
        aliases: b.aliases !== undefined ? b.aliases : existing.aliases,
        allowedTools: b.allowedTools !== undefined ? b.allowedTools : existing.allowedTools,
        content: typeof b.content === 'string' ? b.content : existing.content,
        enabled: b.enabled !== undefined ? b.enabled : existing.enabled,
        updatedAt: Date.now()
      }

      saveCustomCommand(updated)
      res.json(updated)
    } catch (error) {
      log.error('update command error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // DELETE /commands/:id - 删除命令
  router.delete('/commands/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const deleted = deleteCustomCommand(id)
      if (!deleted) {
        return res.status(404).json({ error: 'Command not found' })
      }
      res.status(204).send()
    } catch (error) {
      log.error('delete command error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // POST /commands/import - 从外部工具导入命令
  router.post('/commands/import', (req: Request, res: Response) => {
    try {
      const { source, path: customPath } = req.body ?? {}
      if (!source || !['cursor', 'claude-code'].includes(source)) {
        return res.status(400).json({ error: 'source must be "cursor" or "claude-code"' })
      }

      let importDir: string
      if (typeof customPath === 'string' && customPath.trim()) {
        importDir = customPath.trim()
      } else {
        // 默认路径
        const cwd = process.cwd()
        if (source === 'cursor') {
          importDir = require('path').join(cwd, '.cursor', 'commands')
        } else {
          importDir = require('path').join(cwd, '.claude', 'commands')
        }
      }

      const imported = importCommandsFromDir(importDir, source)
      res.json({ imported: imported.length, commands: imported })
    } catch (error) {
      log.error('import commands error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })

  // GET /commands/discover - 发现可导入的命令源
  router.get('/commands/discover', (_req: Request, res: Response) => {
    try {
      const sources = discoverImportableSources()
      res.json({ sources })
    } catch (error) {
      log.error('discover commands error:', error)
      const { status, body } = toErrorResponse(error)
      res.status(status).json(body)
    }
  })
}
