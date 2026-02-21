/**
 * Workflow 路由 - 工作流引擎 REST API
 */

import fs from 'fs'
import nodePath from 'path'
import type { Router, Request, Response } from 'express'
import { toErrorResponse } from '../errors'
import { createLogger } from '../logger'
import {
  requireScopeForList,
  getScopeForCreate,
  getScopeFromQuery,
  hasScopeAccess,
  ensureStringParam
} from '../scopeUtils'
import { getWorkflowRunner, parseWorkflowDef, WorkflowParseError } from '../core/workflowEngine'
import * as resumeStore from '../core/workflowEngine/resumeStore'
import * as defStore from '../core/workflowEngine/workflowDefStore'
import { scopeStore } from '../core/ScopeStore'
import {
  ensureWorkflowWorkspace,
  getWorkflowPersistentWorkspace,
  getWorkflowRunWorkspace,
  getWorkflowRunWorkspacesDir,
  getWorkflowRunMetaPath,
  getSessionWorkspaceDir
} from '../core/PathProviderCore'
import {
  type WorkflowRunStatus,
  WORKFLOW_MANAGEMENT_SOURCE,
  WORKFLOW_MANAGEMENT_SESSION_LABEL_PENDING,
  isWorkflowManagementSession
} from '@prizm/shared'
import type { IAgentAdapter } from '../adapters/interfaces'
import { emit } from '../core/eventBus'

const log = createLogger('Workflow')

export function createWorkflowRoutes(router: Router, agentAdapter?: IAgentAdapter): void {
  // ─── 工作流定义 ───

  router.get('/workflow/defs', async (req: Request, res: Response) => {
    try {
      const scope = requireScopeForList(req, res)
      if (!scope) return
      let defs = defStore.listDefs(scope)

      // 自动修复单向引用：def→session 存在但 session 不指回 def，或 session 已删除
      if (agentAdapter?.getSession) {
        defs = await Promise.all(
          defs.map(async (d) => {
            const sessionId = d.workflowManagementSessionId
            if (!sessionId) return d
            const session = await agentAdapter.getSession!(scope, sessionId)
            if (!session) {
              defStore.updateDefMetaByDefId(d.id, { workflowManagementSessionId: undefined })
              log.info('Cleared dead workflowManagementSessionId for def', d.name, 'was', sessionId)
              return { ...d, workflowManagementSessionId: undefined }
            }
            const sessionDefId =
              (
                session as {
                  toolMeta?: { workflowDefId?: string }
                  bgMeta?: { workflowDefId?: string }
                }
              ).toolMeta?.workflowDefId ??
              (session as { bgMeta?: { workflowDefId?: string } }).bgMeta?.workflowDefId
            if (sessionDefId !== d.id) {
              defStore.updateDefMetaByDefId(d.id, { workflowManagementSessionId: undefined })
              log.info(
                'Cleared one-way ref: def pointed to session but session does not point back; def',
                d.name,
                'was',
                sessionId
              )
              return { ...d, workflowManagementSessionId: undefined }
            }
            return d
          })
        )
      }

      // 自动修复单向引用：session→def 存在但 def 无 workflowManagementSessionId，从会话侧补全
      if (agentAdapter?.listSessions) {
        const sessions = await agentAdapter.listSessions(scope)
        for (const session of sessions) {
          if (!isWorkflowManagementSession(session)) continue
          const defId =
            (
              session as {
                toolMeta?: { workflowDefId?: string }
                bgMeta?: { workflowDefId?: string }
              }
            ).toolMeta?.workflowDefId ??
            (session as { bgMeta?: { workflowDefId?: string } }).bgMeta?.workflowDefId
          if (!defId) continue
          const def = defStore.getDefById(defId)
          if (!def || def.scope !== scope || def.workflowManagementSessionId) continue
          defStore.updateDefMetaByDefId(defId, { workflowManagementSessionId: session.id })
          log.info(
            'Repaired one-way ref: def had no session ref, set from session',
            def.name,
            session.id
          )
        }
        defs = defStore.listDefs(scope)
      }

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
      void emit('workflow:def.registered', { scope, defId: record.id, name: record.name })
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
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      res.json(defRecord)
    } catch (err) {
      log.error('GET /workflow/defs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 列出流水线版本列表（按时间倒序，无记忆功能） */
  router.get('/workflow/defs/:id/versions', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      if (!hasScopeAccess(req, defRecord.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const versions = defStore.listDefVersions(id)
      res.json(versions)
    } catch (err) {
      log.error('GET /workflow/defs/:id/versions error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 获取指定版本快照的 YAML 内容 */
  router.get('/workflow/defs/:id/versions/:versionId', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      const versionId = ensureStringParam(req.params.versionId)
      if (!id || !versionId) {
        return res.status(400).json({ error: 'definition id and versionId are required' })
      }
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      if (!hasScopeAccess(req, defRecord.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const yamlContent = defStore.getDefVersionContent(id, versionId)
      if (yamlContent === null) return res.status(404).json({ error: 'Version not found' })
      res.json({ id: versionId, yamlContent })
    } catch (err) {
      log.error('GET /workflow/defs/:id/versions/:versionId error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 一键回溯到指定版本（将当前定义替换为该版本内容，当前内容会先被保存为快照） */
  router.post('/workflow/defs/:id/rollback', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      if (!hasScopeAccess(req, defRecord.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const versionId = (req.body && typeof req.body === 'object' && req.body.versionId) as string | undefined
      if (!versionId || typeof versionId !== 'string') {
        return res.status(400).json({ error: 'versionId is required in body' })
      }
      const updated = defStore.rollbackDefToVersion(id, versionId)
      if (!updated) return res.status(404).json({ error: 'Version not found or rollback failed' })
      void emit('workflow:def.registered', { scope: updated.scope, defId: updated.id, name: updated.name })
      res.json(updated)
    } catch (err) {
      log.error('POST /workflow/defs/:id/rollback error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 更新工作流定义元数据（如 descriptionDocumentId） */
  router.patch('/workflow/defs/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      if (!hasScopeAccess(req, defRecord.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const body = (req.body ?? {}) as { descriptionDocumentId?: string | null }
      const patch: { descriptionDocumentId?: string } = {}
      if (body.descriptionDocumentId !== undefined) {
        patch.descriptionDocumentId =
          typeof body.descriptionDocumentId === 'string' && body.descriptionDocumentId.trim()
            ? body.descriptionDocumentId.trim()
            : undefined
      }
      if (Object.keys(patch).length === 0) {
        return res.json(defRecord)
      }
      defStore.updateDefMeta(defRecord.name, defRecord.scope, patch)
      const updated = defStore.getDefById(id)
      const result = updated ?? defRecord
      void emit('workflow:def.registered', {
        scope: result.scope,
        defId: result.id,
        name: result.name
      })
      res.json(result)
    } catch (err) {
      log.error('PATCH /workflow/defs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/workflow/defs/:id', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      const { scope, name } = defRecord

      // 删除 def 前清除对应管理会话上的 workflowDefId/workflowName，避免孤儿引用
      const meta = defStore.getDefMetaByDefId(id)
      const sessionId = meta?.workflowManagementSessionId
      if (sessionId && agentAdapter?.getSession && agentAdapter?.updateSession) {
        try {
          const session = await agentAdapter.getSession(scope, sessionId)
          if (session) {
            if (session.kind === 'tool' && session.toolMeta) {
              await agentAdapter.updateSession(scope, sessionId, {
                toolMeta: {
                  ...session.toolMeta,
                  workflowDefId: undefined,
                  workflowName: undefined
                }
              })
            } else if (session.bgMeta) {
              await agentAdapter.updateSession(scope, sessionId, {
                bgMeta: {
                  ...session.bgMeta,
                  workflowDefId: undefined,
                  workflowName: undefined
                }
              })
            }
            log.info('Cleared session workflow ref for deleted def:', name, 'session:', sessionId)
          }
        } catch (err) {
          log.warn('Clear session ref before def delete failed:', err)
        }
      }

      const ok = defStore.deleteDef(id)
      if (!ok) return res.status(404).json({ error: 'Definition not found' })
      void emit('workflow:def.deleted', { scope, defId: id, name })
      res.json({ deleted: true })
    } catch (err) {
      log.error('DELETE /workflow/defs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 仅创建「待创建」工作流管理会话（不调 LLM），供工作流页「新建工作流会话」或导航卡片带入 initialPrompt 使用 */
  router.post('/workflow/management-session', async (req: Request, res: Response) => {
    try {
      const scope = getScopeFromQuery(req) ?? 'default'
      if (!hasScopeAccess(req, scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const { initialPrompt } = req.body ?? {}
      if (!agentAdapter?.createSession || !agentAdapter?.updateSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const session = await agentAdapter.createSession(scope)
      await agentAdapter.updateSession(scope, session.id, {
        kind: 'tool',
        toolMeta: {
          source: WORKFLOW_MANAGEMENT_SOURCE,
          label: WORKFLOW_MANAGEMENT_SESSION_LABEL_PENDING
        }
      })
      if (typeof initialPrompt === 'string' && initialPrompt.trim() && agentAdapter.appendMessage) {
        await agentAdapter.appendMessage(scope, session.id, {
          role: 'user',
          parts: [{ type: 'text', content: initialPrompt.trim() }]
        })
      }
      log.info('Workflow management session created (pending):', session.id)
      res.status(201).json({ sessionId: session.id })
    } catch (err) {
      log.error('POST /workflow/management-session error:', err)
      const { status, body } = toErrorResponse(err)
      res.status(status).json(body)
    }
  })

  /** 为已有工作流新建工作流管理会话（双向引用，幂等：已有则返回现有 sessionId） */
  router.post('/workflow/defs/:id/management-session', async (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'definition id is required' })
      const defRecord = defStore.getDefById(id)
      if (!defRecord) return res.status(404).json({ error: 'Definition not found' })
      const defScope = defRecord.scope
      const scopeFromReq = getScopeFromQuery(req) ?? null
      if (scopeFromReq != null && scopeFromReq !== defScope) {
        return res.status(403).json({ error: 'scope does not match definition' })
      }
      if (!hasScopeAccess(req, defScope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const meta = defStore.getDefMetaByDefId(id)
      const existingSessionId = meta?.workflowManagementSessionId
      if (existingSessionId && agentAdapter?.getSession) {
        const existingSession = await agentAdapter.getSession(defScope, existingSessionId)
        if (existingSession) {
          return res.status(200).json({ sessionId: existingSessionId })
        }
        // 引用指向的会话已被删除（如用户「重建对话」），需新建并更新 def 引用
      } else if (existingSessionId) {
        return res.status(200).json({ sessionId: existingSessionId })
      }
      if (!agentAdapter?.createSession || !agentAdapter?.updateSession) {
        return res.status(503).json({ error: 'Agent adapter not available' })
      }
      const scopeRoot = scopeStore.getScopeRootPath(defScope)
      ensureWorkflowWorkspace(scopeRoot, defRecord.name)
      const persistentWorkspaceDir = getWorkflowPersistentWorkspace(scopeRoot, defRecord.name)
      const session = await agentAdapter.createSession(defScope)
      await agentAdapter.updateSession(defScope, session.id, {
        kind: 'tool',
        toolMeta: {
          source: WORKFLOW_MANAGEMENT_SOURCE,
          label: `工作流管理：${defRecord.name}`,
          workflowDefId: id,
          workflowName: defRecord.name,
          persistentWorkspaceDir
        }
      })
      const updated = defStore.updateDefMetaByDefId(id, { workflowManagementSessionId: session.id })
      if (!updated)
        log.warn('Failed to update def meta workflowManagementSessionId for def id:', id)
      log.info('Workflow management session created:', defRecord.name, session.id)
      res.status(201).json({ sessionId: session.id })
    } catch (err) {
      log.error('POST /workflow/defs/:id/management-session error:', err)
      const { status, body } = toErrorResponse(err)
      res.status(status).json(body)
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
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'run id is required' })
      const run = resumeStore.getRunById(id)
      if (!run) return res.status(404).json({ error: 'Run not found' })
      if (!hasScopeAccess(req, run.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      res.json(run)
    } catch (err) {
      log.error('GET /workflow/runs/:id error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  /** 完整 run 记录：run + .meta 文件内容 + 工作区路径（供管理会话审计/授权用） */
  router.get('/workflow/runs/:id/full', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'run id is required' })
      const run = resumeStore.getRunById(id)
      if (!run) return res.status(404).json({ error: 'Run not found' })
      if (!hasScopeAccess(req, run.scope)) {
        return res.status(403).json({ error: 'scope access denied' })
      }
      const scopeRoot = scopeStore.getScopeRootPath(run.scope)
      const workflowWorkspace = getWorkflowPersistentWorkspace(scopeRoot, run.workflowName)
      const runWorkspace = getWorkflowRunWorkspace(scopeRoot, run.workflowName, run.id)
      const metaPath = getWorkflowRunMetaPath(scopeRoot, run.workflowName, run.id)
      let runMetaMarkdown: string | null = null
      if (fs.existsSync(metaPath)) {
        try {
          runMetaMarkdown = fs.readFileSync(metaPath, 'utf-8')
        } catch {
          // ignore read error
        }
      }
      const stepSessionWorkspaces: { stepId: string; sessionId: string; workspacePath: string }[] =
        []
      for (const [stepId, result] of Object.entries(run.stepResults)) {
        if (result.sessionId) {
          stepSessionWorkspaces.push({
            stepId,
            sessionId: result.sessionId,
            workspacePath: getSessionWorkspaceDir(scopeRoot, result.sessionId)
          })
        }
      }
      res.json({
        run,
        runMetaMarkdown,
        paths: {
          workflowWorkspace,
          runWorkspace,
          stepSessionWorkspaces
        }
      })
    } catch (err) {
      log.error('GET /workflow/runs/:id/full error:', err)
      res.status(500).json(toErrorResponse(err))
    }
  })

  router.delete('/workflow/runs/:id', (req: Request, res: Response) => {
    try {
      const id = ensureStringParam(req.params.id)
      if (!id) return res.status(400).json({ error: 'run id is required' })
      const runner = getWorkflowRunner()
      const cancelled = runner.cancelWorkflow(id)
      if (cancelled) {
        return res.json({ cancelled: true })
      }
      const deleted = resumeStore.deleteRun(id)
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
