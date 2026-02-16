/**
 * 通用文件系统路由 - Layer 0 基础文件操作
 * 管理 scope 目录下的所有文件
 */

import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { requireScopeForList, getScopeForCreate } from '../scopeUtils'
import { scopeStore } from '../core/ScopeStore'
import * as mdStore from '../core/mdStore'
import { getSessionWorkspaceDir } from '../core/PathProviderCore'
import { EVENT_TYPES_OBJ } from '@prizm/shared'

const log = createLogger('Files')

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

  // POST /files/write - 写入文件
  router.post('/files/write', (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { path: relativePath, content } = req.body as {
        path?: string
        content?: string
      }

      if (!relativePath) {
        res.status(400).json({ error: 'path is required' })
        return
      }

      if (!mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      if (mdStore.isSystemPath(relativePath)) {
        res.status(403).json({ error: 'Cannot write to system directory' })
        return
      }

      const ok = mdStore.writeFileByPath(scopeRoot, relativePath, content ?? '')
      if (!ok) {
        res.status(500).json({ error: 'Failed to write file' })
        return
      }

      // Broadcast file event
      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES_OBJ.FILE_CREATED,
          {
            relativePath,
            scope
          },
          scope
        )
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })

  // POST /files/mkdir - 创建目录
  router.post('/files/mkdir', (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { path: relativePath } = req.body as { path?: string }

      if (!relativePath) {
        res.status(400).json({ error: 'path is required' })
        return
      }

      if (!mdStore.validateRelativePath(relativePath)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      const ok = mdStore.mkdirByPath(scopeRoot, relativePath)
      if (!ok) {
        res.status(500).json({ error: 'Failed to create directory' })
        return
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })

  // POST /files/move - 移动/重命名
  router.post('/files/move', (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const scopeRoot = resolveScopeRoot(req, scope)
      const { from, to } = req.body as { from?: string; to?: string }

      if (!from || !to) {
        res.status(400).json({ error: 'from and to are required' })
        return
      }

      if (!mdStore.validateRelativePath(from) || !mdStore.validateRelativePath(to)) {
        res.status(400).json({ error: 'Invalid path' })
        return
      }

      if (mdStore.isSystemPath(from) || mdStore.isSystemPath(to)) {
        res.status(403).json({ error: 'Cannot move system files' })
        return
      }

      const ok = mdStore.moveFile(scopeRoot, from, to)
      if (!ok) {
        res.status(404).json({ error: 'Source file not found' })
        return
      }

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES_OBJ.FILE_MOVED,
          {
            relativePath: to,
            oldRelativePath: from,
            scope
          },
          scope
        )
      }

      res.json({ ok: true, from, to })
    } catch (e) {
      res.status(500).json(toErrorResponse(e))
    }
  })

  // DELETE /files/delete - 删除文件/目录
  router.delete('/files/delete', (req: Request, res: Response) => {
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
        res.status(403).json({ error: 'Cannot delete system files' })
        return
      }

      const ok = mdStore.deleteByPath(scopeRoot, relativePath)
      if (!ok) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      const wsServer = req.prizmServer
      if (wsServer) {
        wsServer.broadcast(
          EVENT_TYPES_OBJ.FILE_DELETED,
          {
            relativePath,
            scope
          },
          scope
        )
      }

      res.json({ ok: true, relativePath })
    } catch (e) {
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
