/**
 * 通用文件系统路由 - Layer 0 基础文件操作
 * 写操作通过 FileService 统一处理，WS 广播由 EventBus handler 提供
 */

import type { Router, Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { requireScopeForList, getScopeForCreate } from '../scopeUtils'
import { scopeStore } from '../core/ScopeStore'
import * as mdStore from '../core/mdStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'
import * as fileService from '../services/fileService'
import { ValidationError } from '../services/errors'

const log = createLogger('Files')

/** 常见图片扩展名 → Content-Type，用于 /files/serve */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
}

/**
 * 解析请求中的 scope root path
 * 支持 ?sessionWorkspace=sessionId 切换到会话临时工作区
 */
function resolveScopeRoot(req: Request, scope: string): string {
  const rootPath = scopeStore.getScopeRootPath(scope)
  const sessionWorkspace = req.query.sessionWorkspace as string | undefined
  if (sessionWorkspace) {
    return getSessionWorkspaceDir(rootPath, sessionWorkspace)
  }
  return rootPath
}

/** 构建 User OperationContext */
function userCtx(req: Request, scope: string, source: string) {
  return {
    scope,
    actor: {
      type: 'user' as const,
      clientId: req.prizmClient?.clientId,
      source
    }
  }
}

export function createFilesRoutes(router: Router): void {
  // GET /files/list - 列出目录内容
  router.get('/files/list', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = resolveScopeRoot(req, scope)
      const relativePath = (req.query.path as string) || ''
      const recursive = req.query.recursive === 'true'

      if (relativePath && !mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      if (relativePath && mdStore.isSystemPath(relativePath)) {
        res.status(403).json({ error: 'Access to system directory denied' })
        return
      }

      const entries = mdStore.listDirectory(scopeRoot, relativePath, { recursive })
      res.json({ files: entries, scope, path: relativePath || '/' })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })

  // GET /files/read - 读取文件内容
  router.get('/files/read', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = resolveScopeRoot(req, scope)
      const relativePath = req.query.path as string

      if (!relativePath) {
        res.status(400).json({ error: 'path is required' })
        return
      }

      if (!mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      if (mdStore.isSystemPath(relativePath)) {
        res.status(403).json({ error: 'Access to system files denied' })
        return
      }

      const result = mdStore.readFileByPath(scopeRoot, relativePath)
      if (!result) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      res.json({ file: result })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })

  // GET /files/serve - 流式返回文件内容（用于图片等二进制查看，带正确 Content-Type）
  router.get('/files/serve', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = resolveScopeRoot(req, scope)
      const relativePath = req.query.path as string

      if (!relativePath) {
        res.status(400).json({ error: 'path is required' })
        return
      }

      if (!mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      if (mdStore.isSystemPath(relativePath)) {
        res.status(403).json({ error: 'Access to system files denied' })
        return
      }

      const fullPath = path.join(scopeRoot, relativePath)
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) {
        res.status(400).json({ error: 'Not a file' })
        return
      }

      const ext = path.extname(relativePath).toLowerCase()
      const contentType = IMAGE_MIME[ext] ?? 'application/octet-stream'
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'private, max-age=3600')

      const stream = fs.createReadStream(fullPath)
      stream.on('error', (err) => {
        log.warn('files/serve stream error: %s', err.message)
        if (!res.headersSent) res.status(500).json(toErrorResponse(err))
      })
      stream.pipe(res)
    } catch (e) {
      if (!res.headersSent) res.status(500).json(toErrorResponse(e))
    }
  })

  // POST /files/write - 写入文件
  router.post('/files/write', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { path: relativePath, content } = req.body as {
        path?: string
        content?: string
      }

      if (!relativePath) {
        return res.status(400).json({ error: 'path is required' })
      }

      const ctx = userCtx(req, scope, 'api:files')
      const ok = await fileService.writeFile(ctx, scopeRoot, relativePath, content ?? '')
      if (!ok) {
        return res.status(500).json({ error: 'Failed to write file' })
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
      if (e instanceof ValidationError) {
        return res.status(e.statusCode).json({ error: e.message })
      }
      res.status(500).json(toErrorResponse(e))
    }
  })

  // POST /files/mkdir - 创建目录
  router.post('/files/mkdir', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { path: relativePath } = req.body as { path?: string }

      if (!relativePath) {
        return res.status(400).json({ error: 'path is required' })
      }

      const ctx = userCtx(req, scope, 'api:files')
      const ok = await fileService.mkdir(ctx, scopeRoot, relativePath)
      if (!ok) {
        return res.status(500).json({ error: 'Failed to create directory' })
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
      if (e instanceof ValidationError) {
        return res.status(e.statusCode).json({ error: e.message })
      }
      res.status(500).json(toErrorResponse(e))
    }
  })

  // POST /files/move - 移动/重命名
  router.post('/files/move', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { from, to } = req.body as { from?: string; to?: string }

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to are required' })
      }

      const ctx = userCtx(req, scope, 'api:files')
      const ok = await fileService.moveFile(ctx, scopeRoot, from, to)
      if (!ok) {
        return res.status(404).json({ error: 'Source file not found' })
      }

      res.json({ ok: true, from, to })
    } catch (e) {
      if (e instanceof ValidationError) {
        return res.status(e.statusCode).json({ error: e.message })
      }
      res.status(500).json(toErrorResponse(e))
    }
  })

  // DELETE /files/delete - 删除文件/目录
  router.delete('/files/delete', async (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = resolveScopeRoot(req, scope)
      const relativePath = req.query.path as string

      if (!relativePath) {
        return res.status(400).json({ error: 'path is required' })
      }

      const ctx = userCtx(req, scope, 'api:files')
      const ok = await fileService.deleteFile(ctx, scopeRoot, relativePath)
      if (!ok) {
        return res.status(404).json({ error: 'File not found' })
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
      if (e instanceof ValidationError) {
        return res.status(e.statusCode).json({ error: e.message })
      }
      res.status(500).json(toErrorResponse(e))
    }
  })

  // GET /files/stat - 获取文件元信息
  router.get('/files/stat', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = resolveScopeRoot(req, scope)
      const relativePath = req.query.path as string

      if (!relativePath) {
        res.status(400).json({ error: 'path is required' })
        return
      }

      if (!mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      const stat = mdStore.statByPath(scopeRoot, relativePath)
      if (!stat) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      res.json({ stat: { relativePath, ...stat } })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })
}
