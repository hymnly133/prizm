/**
 * 内置资源类型注册 — 启动时调用 registerBuiltinResourceRefs() 完成全量注册
 *
 * 支持 10 种资源类型：doc, todo, file, workflow, run, task, session, schedule, cron, memory
 */

import * as fs from 'fs'
import * as path from 'path'
import { registerResourceRef } from './registry'
import type { ResourceRefDef, ResourceRefItem, ResourceRefDetail } from './types'
import { scopeStore } from '../ScopeStore'
import { buildRunRefContent } from '../workflowEngine/runRefContent'
import { createLogger } from '../../logger'

const log = createLogger('BuiltinResourceRefs')

let registered = false

export function registerBuiltinResourceRefs(): void {
  if (registered) return
  registered = true

  registerResourceRef(docRef)
  registerResourceRef(todoRef)
  registerResourceRef(fileRef)
  registerResourceRef(workflowRef)
  registerResourceRef(runRef)
  registerResourceRef(taskRef)
  registerResourceRef(sessionRef)
  registerResourceRef(scheduleRef)
  registerResourceRef(cronRef)
  registerResourceRef(memoryRef)
}

// ─── helpers ───

function crossScopeFind<T>(
  lookup: (scope: string) => T | null
): { scope: string; data: T } | null {
  for (const scope of scopeStore.getAllScopes()) {
    const data = lookup(scope)
    if (data) return { scope, data }
  }
  return null
}

// ─── doc ───

const docRef: ResourceRefDef = {
  type: 'doc',
  async list(scope, limit = 50) {
    const data = scopeStore.getScopeData(scope)
    return data.documents.slice(0, limit).map((d) => ({
      id: d.id,
      type: 'doc' as const,
      title: (d.title ?? '').trim() || '(无标题)',
      charCount: (d.content ?? '').length,
      updatedAt: d.updatedAt ?? 0,
      groupOrStatus: undefined
    }))
  },
  async resolve(scope, id) {
    const d = scopeStore.getScopeData(scope).documents.find((x) => x.id === id)
    if (!d) return null
    const content = (d.content ?? '').trim()
    return {
      id: d.id,
      type: 'doc',
      title: (d.title ?? '').trim() || '(无标题)',
      charCount: content.length,
      updatedAt: d.updatedAt ?? 0,
      content
    }
  },
  async crossScopeResolve(id) {
    const found = crossScopeFind((scope) => {
      const d = scopeStore.getScopeData(scope).documents.find((x) => x.id === id)
      if (!d) return null
      const content = (d.content ?? '').trim()
      return {
        id: d.id,
        type: 'doc' as const,
        title: (d.title ?? '').trim() || '(无标题)',
        charCount: content.length,
        updatedAt: d.updatedAt ?? 0,
        content
      }
    })
    return found ? { scope: found.scope, detail: found.data } : null
  }
}

// ─── todo ───

const todoRef: ResourceRefDef = {
  type: 'todo',
  async list(scope, limit = 50) {
    const data = scopeStore.getScopeData(scope)
    const items: ResourceRefItem[] = []
    for (const list of data.todoLists ?? []) {
      for (const it of list.items ?? []) {
        const desc = (it as { description?: string }).description ?? ''
        items.push({
          id: it.id,
          type: 'todo',
          title: (it.title ?? '').trim() || '(无标题)',
          charCount: (it.title?.length ?? 0) + desc.length,
          updatedAt: (it.updatedAt as number) ?? 0,
          groupOrStatus: it.status
        })
        if (items.length >= limit) break
      }
      if (items.length >= limit) break
    }
    return items
  },
  async resolve(scope, id) {
    const data = scopeStore.getScopeData(scope)
    for (const list of data.todoLists ?? []) {
      const it = (list.items ?? []).find((x) => x.id === id)
      if (it) {
        const desc = (it as { description?: string }).description ?? ''
        const content = `${it.title ?? ''}\n${desc}`.trim()
        return {
          id: it.id,
          type: 'todo',
          title: (it.title ?? '').trim() || '(无标题)',
          charCount: content.length,
          updatedAt: (it.updatedAt as number) ?? 0,
          groupOrStatus: it.status,
          content
        }
      }
    }
    return null
  },
  async crossScopeResolve(id) {
    const found = crossScopeFind((scope) => {
      const data = scopeStore.getScopeData(scope)
      for (const list of data.todoLists ?? []) {
        const it = (list.items ?? []).find((x) => x.id === id)
        if (it) {
          const desc = (it as { description?: string }).description ?? ''
          const content = `${it.title ?? ''}\n${desc}`.trim()
          return {
            id: it.id,
            type: 'todo' as const,
            title: (it.title ?? '').trim() || '(无标题)',
            charCount: content.length,
            updatedAt: (it.updatedAt as number) ?? 0,
            groupOrStatus: it.status,
            content
          }
        }
      }
      return null
    })
    return found ? { scope: found.scope, detail: found.data } : null
  }
}

// ─── file (resolve only) ───

const fileRef: ResourceRefDef = {
  type: 'file',
  async resolve(_scope, encodedPath) {
    const filePath = encodedPath.replace(/%29/g, ')')
    try {
      const resolved = path.resolve(filePath)
      if (!fs.existsSync(resolved)) return null
      const stat = fs.statSync(resolved)
      const baseName = path.basename(resolved)

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved)
        const content = `目录 ${resolved} 内容：\n${entries.join('\n')}`
        return {
          id: encodedPath,
          type: 'file',
          title: baseName,
          charCount: content.length,
          updatedAt: stat.mtimeMs,
          content
        }
      }

      const MAX_SIZE = 512 * 1024
      if (stat.size > MAX_SIZE) {
        const content =
          `[文件过大，仅读取前 ${MAX_SIZE} 字节]\n` +
          fs.readFileSync(resolved, 'utf-8').slice(0, MAX_SIZE)
        return {
          id: encodedPath,
          type: 'file',
          title: baseName,
          charCount: content.length,
          updatedAt: stat.mtimeMs,
          content
        }
      }

      const content = fs.readFileSync(resolved, 'utf-8')
      return {
        id: encodedPath,
        type: 'file',
        title: baseName,
        charCount: content.length,
        updatedAt: stat.mtimeMs,
        content
      }
    } catch {
      return null
    }
  }
}

// ─── workflow (WorkflowDefRecord) ───

function getWorkflowDefStore() {
  // Lazy import to avoid circular dependency
  return require('../workflowEngine/workflowDefStore') as typeof import('../workflowEngine/workflowDefStore')
}

const workflowRef: ResourceRefDef = {
  type: 'workflow',
  async list(scope, limit = 50) {
    try {
      const store = getWorkflowDefStore()
      const defs = store.listDefs(scope)
      return defs.slice(0, limit).map((d) => ({
        id: d.id,
        type: 'workflow' as const,
        title: d.name,
        charCount: (d.yamlContent ?? '').length,
        updatedAt: d.updatedAt ?? 0,
        groupOrStatus: d.description
      }))
    } catch {
      return []
    }
  },
  async resolve(scope, id) {
    try {
      const store = getWorkflowDefStore()
      const def = store.getDefByName(id, scope) ?? store.getDefById(id)
      if (!def) return null
      return {
        id: def.id,
        type: 'workflow',
        title: def.name,
        charCount: (def.yamlContent ?? '').length,
        updatedAt: def.updatedAt ?? 0,
        content: def.yamlContent ?? ''
      }
    } catch {
      return null
    }
  },
  async crossScopeResolve(id) {
    try {
      const store = getWorkflowDefStore()
      const def = store.getDefById(id)
      if (!def) return null
      return {
        scope: def.scope,
        detail: {
          id: def.id,
          type: 'workflow' as const,
          title: def.name,
          charCount: (def.yamlContent ?? '').length,
          updatedAt: def.updatedAt ?? 0,
          content: def.yamlContent ?? ''
        }
      }
    } catch {
      return null
    }
  }
}

// ─── run (WorkflowRun) ───

function getResumeStore() {
  return require('../workflowEngine/resumeStore') as typeof import('../workflowEngine/resumeStore')
}

const runRef: ResourceRefDef = {
  type: 'run',
  async list(scope, limit = 50) {
    try {
      const store = getResumeStore()
      const runs = store.listRuns(scope, undefined, limit)
      return runs.map((r) => ({
        id: r.id,
        type: 'run' as const,
        title: `${r.workflowName} #${r.id.slice(0, 8)}`,
        charCount: 0,
        updatedAt: r.updatedAt ?? 0,
        groupOrStatus: r.status
      }))
    } catch {
      return []
    }
  },
  async resolve(scope, id) {
    try {
      const store = getResumeStore()
      const run = store.getRunById(id)
      if (!run) return null
      const scopeRoot = scopeStore.getScopeRootPath(run.scope)
      const content = buildRunRefContent(scopeRoot, run)
      return {
        id: run.id,
        type: 'run',
        title: `${run.workflowName} #${run.id.slice(0, 8)}`,
        charCount: content.length,
        updatedAt: run.updatedAt ?? 0,
        groupOrStatus: run.status,
        content
      }
    } catch {
      return null
    }
  },
  async crossScopeResolve(id) {
    try {
      const store = getResumeStore()
      const run = store.getRunById(id)
      if (!run) return null
      const scopeRoot = scopeStore.getScopeRootPath(run.scope)
      const content = buildRunRefContent(scopeRoot, run)
      return {
        scope: run.scope,
        detail: {
          id: run.id,
          type: 'run',
          title: `${run.workflowName} #${run.id.slice(0, 8)}`,
          charCount: content.length,
          updatedAt: run.updatedAt ?? 0,
          groupOrStatus: run.status,
          content
        }
      }
    } catch {
      return null
    }
  }
}

// ─── task (TaskRun) ───

const taskRef: ResourceRefDef = {
  type: 'task',
  async list(scope, limit = 50) {
    try {
      const store = getResumeStore()
      const tasks = store.listTaskRuns(scope, undefined, { limit })
      return tasks.map((t) => ({
        id: t.id,
        type: 'task' as const,
        title: t.label || `Task #${t.id.slice(0, 8)}`,
        charCount: (t.output ?? '').length,
        updatedAt: t.finishedAt ?? t.createdAt ?? 0,
        groupOrStatus: t.status
      }))
    } catch {
      return []
    }
  },
  async resolve(_scope, id) {
    try {
      const store = getResumeStore()
      const task = store.getTaskRun(id)
      if (!task) return null
      const content = JSON.stringify(
        { id: task.id, label: task.label, status: task.status, input: task.input, output: task.output },
        null,
        2
      )
      return {
        id: task.id,
        type: 'task',
        title: task.label || `Task #${task.id.slice(0, 8)}`,
        charCount: content.length,
        updatedAt: task.finishedAt ?? task.createdAt ?? 0,
        groupOrStatus: task.status,
        content
      }
    } catch {
      return null
    }
  },
  async crossScopeResolve(id) {
    try {
      const store = getResumeStore()
      const task = store.getTaskRun(id)
      if (!task) return null
      const content = JSON.stringify(
        { id: task.id, label: task.label, status: task.status, input: task.input, output: task.output },
        null,
        2
      )
      return {
        scope: task.scope,
        detail: {
          id: task.id,
          type: 'task',
          title: task.label || `Task #${task.id.slice(0, 8)}`,
          charCount: content.length,
          updatedAt: task.finishedAt ?? task.createdAt ?? 0,
          groupOrStatus: task.status,
          content
        }
      }
    } catch {
      return null
    }
  }
}

// ─── session ───

const sessionRef: ResourceRefDef = {
  type: 'session',
  async list(scope, limit = 50) {
    const data = scopeStore.getScopeData(scope)
    const sessions = data.agentSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
    return sessions.map((s) => {
      const firstUserMsg = s.messages.find((m) => m.role === 'user')
      const preview = firstUserMsg
        ? (firstUserMsg.parts.find((p) => p.type === 'text') as { content: string } | undefined)
            ?.content?.slice(0, 60) ?? ''
        : ''
      return {
        id: s.id,
        type: 'session' as const,
        title: preview || `会话 #${s.id.slice(0, 8)}`,
        charCount: 0,
        updatedAt: s.updatedAt ?? 0,
        groupOrStatus: s.kind ?? 'interactive'
      }
    })
  },
  async resolve(scope, id) {
    const session = scopeStore.getScopeData(scope).agentSessions.find((s) => s.id === id)
    if (!session) return null
    const summary =
      session.llmSummary ??
      session.messages
        .filter((m) => m.role === 'user')
        .map((m) => (m.parts.find((p) => p.type === 'text') as { content: string } | undefined)?.content ?? '')
        .join('\n')
        .slice(0, 2000)
    return {
      id: session.id,
      type: 'session',
      title: `会话 #${session.id.slice(0, 8)}`,
      charCount: summary.length,
      updatedAt: session.updatedAt ?? 0,
      groupOrStatus: session.kind ?? 'interactive',
      content: summary,
      summary
    }
  },
  async crossScopeResolve(id) {
    const found = crossScopeFind((scope) => {
      return scopeStore.getScopeData(scope).agentSessions.find((s) => s.id === id) ?? null
    })
    if (!found) return null
    const detail = await sessionRef.resolve(found.scope, id)
    return detail ? { scope: found.scope, detail } : null
  }
}

// ─── schedule ───

function getMdStore() {
  return require('../mdStore') as typeof import('../mdStore')
}

const scheduleRef: ResourceRefDef = {
  type: 'schedule',
  async list(scope, limit = 50) {
    try {
      const store = getMdStore()
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const items = store.readScheduleItems(scopeRoot)
      return items.slice(0, limit).map((s) => ({
        id: s.id,
        type: 'schedule' as const,
        title: s.title,
        charCount: (s.description ?? '').length,
        updatedAt: s.updatedAt ?? 0,
        groupOrStatus: s.status
      }))
    } catch {
      return []
    }
  },
  async resolve(scope, id) {
    try {
      const store = getMdStore()
      const scopeRoot = scopeStore.getScopeRootPath(scope)
      const item = store.readSingleScheduleById(scopeRoot, id)
      if (!item) return null
      const content = JSON.stringify(
        { id: item.id, title: item.title, description: item.description, type: item.type, startTime: item.startTime, endTime: item.endTime, status: item.status },
        null,
        2
      )
      return {
        id: item.id,
        type: 'schedule',
        title: item.title,
        charCount: content.length,
        updatedAt: item.updatedAt ?? 0,
        groupOrStatus: item.status,
        content
      }
    } catch {
      return null
    }
  },
  async crossScopeResolve(id) {
    const found = crossScopeFind((scope) => {
      try {
        const store = getMdStore()
        const scopeRoot = scopeStore.getScopeRootPath(scope)
        return store.readSingleScheduleById(scopeRoot, id)
      } catch {
        return null
      }
    })
    if (!found) return null
    const detail = await scheduleRef.resolve(found.scope, id)
    return detail ? { scope: found.scope, detail } : null
  }
}

// ─── cron ───

function getCronStore() {
  return require('../cronScheduler/cronStore') as typeof import('../cronScheduler/cronStore')
}

const cronRef: ResourceRefDef = {
  type: 'cron',
  async list(scope, limit = 50) {
    try {
      const store = getCronStore()
      const jobs = store.listJobs(scope)
      return jobs.slice(0, limit).map((j) => ({
        id: j.id,
        type: 'cron' as const,
        title: j.name,
        charCount: (j.taskPrompt ?? '').length,
        updatedAt: j.updatedAt ?? 0,
        groupOrStatus: j.status
      }))
    } catch {
      return []
    }
  },
  async resolve(scope, id) {
    try {
      const store = getCronStore()
      const job = store.getJobById(id)
      if (!job) return null
      const content = JSON.stringify(
        { id: job.id, name: job.name, schedule: job.schedule, taskPrompt: job.taskPrompt, status: job.status },
        null,
        2
      )
      return {
        id: job.id,
        type: 'cron',
        title: job.name,
        charCount: content.length,
        updatedAt: job.updatedAt ?? 0,
        groupOrStatus: job.status,
        content
      }
    } catch {
      return null
    }
  },
  async crossScopeResolve(id) {
    try {
      const store = getCronStore()
      const job = store.getJobById(id)
      if (!job) return null
      const content = JSON.stringify(
        { id: job.id, name: job.name, schedule: job.schedule, taskPrompt: job.taskPrompt, status: job.status },
        null,
        2
      )
      return {
        scope: job.scope,
        detail: {
          id: job.id,
          type: 'cron',
          title: job.name,
          charCount: content.length,
          updatedAt: job.updatedAt ?? 0,
          groupOrStatus: job.status,
          content
        }
      }
    } catch {
      return null
    }
  }
}

// ─── memory (resolve only) ───

function getEverMemService() {
  return require('../../llm/EverMemService') as typeof import('../../llm/EverMemService')
}

const memoryRef: ResourceRefDef = {
  type: 'memory',
  async resolve(_scope, id) {
    try {
      const service = getEverMemService()
      const mem = await service.getMemoryById(id)
      if (!mem) return null
      return {
        id: mem.id,
        type: 'memory',
        title: (mem.memory ?? '').slice(0, 60),
        charCount: (mem.memory ?? '').length,
        updatedAt: mem.updated_at ? new Date(mem.updated_at).getTime() : 0,
        groupOrStatus: mem.memory_type,
        content: mem.memory ?? ''
      }
    } catch (err) {
      log.error('resolve memory failed:', err)
      return null
    }
  }
}
