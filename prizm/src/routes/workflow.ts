/**
 * Workflow 路由 - 工作流引擎 REST API
 */

import fs from 'fs'
import nodePath from 'path'
import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import { requireScopeForList, getScopeForCreate } from '../scopeUtils'
import { getWorkflowRunner, parseWorkflowDef, WorkflowParseError } from '../core/workflowEngine'
import * as resumeStore from '../core/workflowEngine/resumeStore'
import * as defStore from '../core/workflowEngine/workflowDefStore'
import { scopeStore } from '../core/ScopeStore'
import {
  getWorkflowPersistentWorkspace,
  getWorkflowRunWorkspace,
  getWorkflowRunWorkspacesDir
} from '../core/PathProviderCore'
import type { WorkflowRunStatus } from '@prizm/shared'

const log = createLogger('Workflow')

export function createWorkflowRoutes(router: Router): void {
  // ─── 工作流定义 ───

  router.get('/workflow/defs', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const defs = defStore.listDefs(scope)
      res.json(defs)
    } catch (err) {
      log.error('GET /workflow/defs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.post('/workflow/defs', (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const { name, yaml: yamlContent, description } = req.body
      if (!name || !yamlContent) {
        return res.status(400).json({ error: 'name and yaml are required' })
      }

      const def = parseWorkflowDef(yamlContent)
      const triggersJson = def.triggers ? JSON.stringify(def.triggers) : undefined
      const record = defStore.registerDef(
        name,
        scope,
        yamlContent,
        description ?? def.description,
        triggersJson
      )
      res.status(201).json(record)
    } catch (err) {
      if (err instanceof WorkflowParseError) {
        return res.status(400).json({ error: err.message })
      }
      log.error('POST /workflow/defs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/defs/:id', (req: Request, res: Response) => {
    try {
      const defRecord = defStore.getDefById(req.params.id as string)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      res.json(defRecord)
    } catch (err) {
      log.error('GET /workflow/defs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/workflow/defs/:id', (req: Request, res: Response) => {
    try {
      const ok = defStore.deleteDef(req.params.id)
      if (!ok) return res.status(404).json({ error: 'Definition not found' })
      res.json({ deleted: true })
    } catch (err) {
      log.error('DELETE /workflow/defs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // ─── 工作流运行 ───

  router.post('/workflow/run', async (req: Request, res: Response) => {
    try {
      const scope = getScopeForCreate(req)
      const { workflow_name, yaml: yamlStr, args } = req.body

      let def
      if (yamlStr) {
        def = parseWorkflowDef(yamlStr)
      } else if (workflow_name) {
        const defRecord = defStore.getDefByName(workflow_name, scope)
        if (!defRecord) {
          return res.status(404).json({ error: `Workflow "${workflow_name}" not registered` })
        }
        def = parseWorkflowDef(defRecord.yamlContent)
      } else {
        return res.status(400).json({ error: 'Provide yaml or workflow_name' })
      }

      const runner = getWorkflowRunner()
      const runId = runner.startWorkflow(scope, def, {
        args,
        triggerType: 'manual'
      })
      res.status(202).json({
        runId,
        status: 'running',
        message: `Workflow "${def.name}" started`
      })
    } catch (err) {
      if (err instanceof WorkflowParseError) {
        return res.status(400).json({ error: err.message })
      }
      log.error('POST /workflow/run error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.post('/workflow/resume', async (req: Request, res: Response) => {
    try {
      const { resume_token, approved } = req.body
      if (!resume_token) {
        return res.status(400).json({ error: 'resume_token is required' })
      }

      const runner = getWorkflowRunner()
      const result = await runner.resumeWorkflow(resume_token, approved !== false)
      res.json(result)
    } catch (err) {
      log.error('POST /workflow/resume error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/runs', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const status =
        typeof req.query.status === 'string' ? (req.query.status as WorkflowRunStatus) : undefined
      const runs = resumeStore.listRuns(scope, status)
      res.json(runs)
    } catch (err) {
      log.error('GET /workflow/runs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/runs/:id', (req: Request, res: Response) => {
    try {
      const run = resumeStore.getRunById(req.params.id)
      if (!run) return res.status(404).json({ error: 'Run not found' })
      res.json(run)
    } catch (err) {
      log.error('GET /workflow/runs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/workflow/runs/:id', (req: Request, res: Response) => {
    try {
      const runner = getWorkflowRunner()
      const cancelled = runner.cancelWorkflow(req.params.id)
      if (cancelled) {
        return res.json({ cancelled: true })
      }
      const deleted = resumeStore.deleteRun(req.params.id)
      if (!deleted) return res.status(404).json({ error: 'Run not found' })
      res.json({ deleted: true })
    } catch (err) {
      log.error('DELETE /workflow/runs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  // ─── 工作空间文件 API ───

  router.get('/workflow/defs/:name/workspace', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const dir = getWorkflowPersistentWorkspace(scopeRoot, req.params.name as string)
      res.json(listDirEntries(dir))
    } catch (err) {
      log.error('GET /workflow/defs/:name/workspace error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/runs/:id/workspace', (req: Request, res: Response) => {
    try {
      const run = resumeStore.getRunById(req.params.id as string)
      if (!run) return res.status(404).json({ error: 'Run not found' })
      const scopeRoot = scopeStore.getScopeRootPath(run.scope)
      const dir = getWorkflowRunWorkspace(scopeRoot, run.workflowName, run.id)
      res.json(listDirEntries(dir))
    } catch (err) {
      log.error('GET /workflow/runs/:id/workspace error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/defs/:name/workspace/runs', (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const dir = getWorkflowRunWorkspacesDir(scopeRoot, req.params.name as string)
      if (!fs.existsSync(dir)) return res.json([])
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
          runId: e.name,
          files: listDirEntries(nodePath.join(dir, e.name))
        }))
      res.json(entries)
    } catch (err) {
      log.error('GET /workflow/defs/:name/workspace/runs error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.get('/workflow/workspace/file', (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) return res.status(400).json({ error: 'path query required' })
      if (filePath.includes('..')) return res.status(400).json({ error: 'Invalid path' })

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      const resolved = nodePath.resolve(scopeRoot, filePath)
      if (!resolved.startsWith(nodePath.resolve(scopeRoot))) {
        return res.status(403).json({ error: 'Path traversal denied' })
      }

      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' })
      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' })
      if (stat.size > 2 * 1024 * 1024)
        return res.status(413).json({ error: 'File too large (>2MB)' })

      const content = fs.readFileSync(resolved, 'utf-8')
      res.json({ path: filePath, size: stat.size, content })
    } catch (err) {
      log.error('GET /workflow/workspace/file error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/workflow/workspace/file', (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) return res.status(400).json({ error: 'path query required' })
      if (filePath.includes('..')) return res.status(400).json({ error: 'Invalid path' })

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      const resolved = nodePath.resolve(scopeRoot, filePath)
      if (!resolved.startsWith(nodePath.resolve(scopeRoot))) {
        return res.status(403).json({ error: 'Path traversal denied' })
      }

      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' })
      fs.rmSync(resolved, { recursive: true, force: true })
      res.json({ deleted: true })
    } catch (err) {
      log.error('DELETE /workflow/workspace/file error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.post('/workflow/workspace/upload', (req: Request, res: Response) => {
    try {
      const { targetDir, fileName, contentBase64 } = req.body
      if (!targetDir || !fileName || !contentBase64) {
        return res.status(400).json({ error: 'targetDir, fileName, contentBase64 required' })
      }
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return res.status(400).json({ error: 'Invalid fileName' })
      }
      if (targetDir.includes('..')) {
        return res.status(400).json({ error: 'Invalid targetDir' })
      }

      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      const resolvedDir = nodePath.resolve(scopeRoot, targetDir)
      if (!resolvedDir.startsWith(nodePath.resolve(scopeRoot))) {
        return res.status(403).json({ error: 'Path traversal denied' })
      }

      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true })
      }

      const filePath = nodePath.join(resolvedDir, fileName)
      const buffer = Buffer.from(contentBase64, 'base64')

      const MAX_SIZE = 10 * 1024 * 1024
      if (buffer.length > MAX_SIZE) {
        return res.status(413).json({ error: 'File too large (>10MB)' })
      }

      fs.writeFileSync(filePath, buffer)
      res.json({
        ok: true,
        path: nodePath.relative(scopeRoot, filePath).replace(/\\/g, '/'),
        size: buffer.length
      })
    } catch (err) {
      log.error('POST /workflow/workspace/upload error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.post('/workflow/workspace/resolve-path', (req: Request, res: Response) => {
    try {
      const { workflowName, runId, type } = req.body
      if (!workflowName) {
        return res.status(400).json({ error: 'workflowName required' })
      }
      const scope = requireScopeForList(req, res)
      if (!scope) return
      const scopeRoot = scopeStore.getScopeRootPath(scope)

      let absolutePath: string
      if (type === 'run' && runId) {
        absolutePath = getWorkflowRunWorkspace(scopeRoot, workflowName, runId)
      } else {
        absolutePath = getWorkflowPersistentWorkspace(scopeRoot, workflowName)
      }

      const relativePath = nodePath.relative(scopeRoot, absolutePath).replace(/\\/g, '/')
      res.json({ absolutePath, relativePath })
    } catch (err) {
      log.error('POST /workflow/workspace/resolve-path error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })
}

// ─── Helpers ───

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

function listDirEntries(dir: string): FileEntry[] {
  if (!fs.existsSync(dir)) return []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => {
        const fullPath = nodePath.join(dir, e.name)
        const stat = fs.statSync(fullPath)
        return {
          name: e.name,
          type: e.isDirectory() ? ('directory' as const) : ('file' as const),
          size: e.isFile() ? stat.size : undefined,
          modifiedAt: stat.mtimeMs
        }
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch {
    return []
  }
}
