/**
 * Workflow Def Store — 文件系统持久化
 *
 * 将工作流定义存储为 YAML 文件，替代 SQLite 存储。
 * 文件布局：
 *   {scopeRoot}/.prizm/workflows/{workflowName}/workflow.yaml   — 纯 WorkflowDef YAML
 *   {scopeRoot}/.prizm/workflows/{workflowName}/.meta/def.json  — { id, createdAt, updatedAt }
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import {
  getWorkflowsDir,
  getWorkflowDefPath,
  getWorkflowDefMetaPath,
  getWorkflowDefVersionsDir,
  getWorkflowDefVersionPath,
  ensureWorkflowWorkspace,
  workflowDirName
} from '../PathProviderCore'
import { scopeStore } from '../ScopeStore'
import type { WorkflowDefRecord, WorkflowDefVersionItem } from '@prizm/shared'

const log = createLogger('WorkflowDefStore')

interface DefMeta {
  id: string
  createdAt: number
  updatedAt: number
  /** 关联的工作流管理会话 ID（AI 创建/编辑时写入） */
  workflowManagementSessionId?: string
  /** 工作流描述/使用说明文档 ID（管理会话内至多一份指导文档可标记为此） */
  descriptionDocumentId?: string
}

// ─── 内部辅助 ───

function legacySafeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
}

function migrateWorkflowDir(scopeRoot: string, oldDirName: string, newDirName: string): void {
  try {
    const workflowsDir = getWorkflowsDir(scopeRoot)
    const oldPath = path.join(workflowsDir, oldDirName)
    const newPath = path.join(workflowsDir, newDirName)
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.renameSync(oldPath, newPath)
      log.info('Migrated workflow dir:', oldDirName, '→', newDirName)
    }
  } catch (err) {
    log.warn('Failed to migrate workflow dir:', oldDirName, '→', newDirName, err)
  }
}

function readMeta(metaPath: string): DefMeta | null {
  try {
    if (!fs.existsSync(metaPath)) return null
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
    return {
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      workflowManagementSessionId: raw.workflowManagementSessionId ?? raw.toolLLMSessionId,
      descriptionDocumentId: raw.descriptionDocumentId
    } as DefMeta
  } catch {
    return null
  }
}

function writeMeta(metaPath: string, meta: DefMeta): void {
  const dir = path.dirname(metaPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

function extractYamlFields(yamlContent: string): {
  name?: string
  description?: string
  triggersJson?: string
} {
  try {
    const parsed = yaml.load(yamlContent)
    if (!parsed || typeof parsed !== 'object') return {}
    const obj = parsed as Record<string, unknown>
    return {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      description: typeof obj.description === 'string' ? obj.description : undefined,
      triggersJson: obj.triggers ? JSON.stringify(obj.triggers) : undefined
    }
  } catch {
    return {}
  }
}

function readDefFromDisk(
  scopeRoot: string,
  dirName: string,
  scope: string
): WorkflowDefRecord | null {
  const defPath = getWorkflowDefPath(scopeRoot, dirName)
  if (!fs.existsSync(defPath)) return null

  try {
    const yamlContent = fs.readFileSync(defPath, 'utf-8')
    const metaPath = getWorkflowDefMetaPath(scopeRoot, dirName)
    const meta = readMeta(metaPath)

    const stat = fs.statSync(defPath)
    const id = meta?.id ?? genUniqueId()
    const createdAt = meta?.createdAt ?? stat.birthtimeMs
    const updatedAt = meta?.updatedAt ?? stat.mtimeMs

    if (!meta) {
      writeMeta(metaPath, { id, createdAt, updatedAt })
    }

    const extracted = extractYamlFields(yamlContent)

    return {
      id,
      name: extracted.name ?? dirName,
      scope,
      yamlContent,
      description: extracted.description,
      triggersJson: extracted.triggersJson,
      createdAt,
      updatedAt,
      workflowManagementSessionId: meta?.workflowManagementSessionId,
      descriptionDocumentId: meta?.descriptionDocumentId
    }
  } catch (err) {
    log.warn('Failed to read workflow def:', dirName, err)
    return null
  }
}

// ─── 公开 API ───

export function registerDef(
  name: string,
  scope: string,
  yamlContent: string,
  description?: string,
  triggersJson?: string
): WorkflowDefRecord {
  const scopeRoot = scopeStore.getScopeRootPath(scope)

  const newDir = workflowDirName(name)
  const legacyDir = legacySafeName(name)
  if (legacyDir !== newDir) {
    migrateWorkflowDir(scopeRoot, legacyDir, newDir)
  }

  ensureWorkflowWorkspace(scopeRoot, name)

  const defPath = getWorkflowDefPath(scopeRoot, name)
  const metaPath = getWorkflowDefMetaPath(scopeRoot, name)

  // 版本管理：更新前将当前内容保存为版本快照（仅当存在且与新内容不同时）
  if (fs.existsSync(defPath)) {
    try {
      const currentYaml = fs.readFileSync(defPath, 'utf-8')
      if (currentYaml.trim() && currentYaml.trim() !== yamlContent.trim()) {
        const versionsDir = getWorkflowDefVersionsDir(scopeRoot, name)
        if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true })
        const versionId = String(Date.now())
        const versionPath = getWorkflowDefVersionPath(scopeRoot, name, versionId)
        fs.writeFileSync(versionPath, currentYaml, 'utf-8')
        log.info('Saved workflow def version:', name, 'versionId:', versionId)
      }
    } catch (err) {
      log.warn('Failed to save workflow def version snapshot:', name, err)
    }
  }

  const existingMeta = readMeta(metaPath)
  const now = Date.now()
  const meta: DefMeta = {
    id: existingMeta?.id ?? genUniqueId(),
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now,
    // 保留与定义内容无关的 meta 字段，避免 upsert 时丢失（如管理会话更新工作流 YAML 后仍保持双向引用）
    workflowManagementSessionId: existingMeta?.workflowManagementSessionId,
    descriptionDocumentId: existingMeta?.descriptionDocumentId
  }

  fs.writeFileSync(defPath, yamlContent, 'utf-8')
  writeMeta(metaPath, meta)

  const extracted = extractYamlFields(yamlContent)

  return {
    id: meta.id,
    name,
    scope,
    yamlContent,
    description: description ?? extracted.description,
    triggersJson: triggersJson ?? extracted.triggersJson,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    workflowManagementSessionId: meta.workflowManagementSessionId,
    descriptionDocumentId: meta.descriptionDocumentId
  }
}

export function getDefById(id: string): WorkflowDefRecord | null {
  for (const scope of scopeStore.getAllScopes()) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue

    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const metaPath = getWorkflowDefMetaPath(scopeRoot, d.name)
        const meta = readMeta(metaPath)
        if (meta?.id === id) {
          return readDefFromDisk(scopeRoot, d.name, scope)
        }
      }
    } catch {
      /* skip inaccessible dirs */
    }
  }
  return null
}

export function getDefByName(name: string, scope: string): WorkflowDefRecord | null {
  const scopeRoot = scopeStore.getScopeRootPath(scope)

  const dirName = workflowDirName(name)
  const result = readDefFromDisk(scopeRoot, dirName, scope)
  if (result) return result

  const legacyDir = legacySafeName(name)
  if (legacyDir !== dirName) {
    const legacyResult = readDefFromDisk(scopeRoot, legacyDir, scope)
    if (legacyResult) {
      migrateWorkflowDir(scopeRoot, legacyDir, dirName)
      return legacyResult
    }
  }

  return null
}

export function listDefs(scope?: string): WorkflowDefRecord[] {
  const scopes = scope ? [scope] : scopeStore.getAllScopes()
  const results: WorkflowDefRecord[] = []

  for (const s of scopes) {
    const scopeRoot = scopeStore.getScopeRootPath(s)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue

    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const rec = readDefFromDisk(scopeRoot, d.name, s)
        if (rec) {
          const expectedDir = workflowDirName(rec.name)
          if (d.name !== expectedDir) {
            migrateWorkflowDir(scopeRoot, d.name, expectedDir)
          }
          results.push(rec)
        }
      }
    } catch (err) {
      log.warn('Failed to list workflow defs for scope:', s, err)
    }
  }

  results.sort((a, b) => b.updatedAt - a.updatedAt)
  return results
}

/**
 * 获取工作流的 DefMeta 元数据（按 name+scope 定位，name 会经 workflowDirName 转目录名）
 */
export function getDefMeta(name: string, scope: string): DefMeta | null {
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const dirName = workflowDirName(name)
  const metaPath = getWorkflowDefMetaPath(scopeRoot, dirName)
  return readMeta(metaPath)
}

/**
 * 按定义 ID 查找 DefMeta（避免 defRecord.name 与磁盘目录名不一致导致读错 meta）
 */
export function getDefMetaByDefId(id: string): DefMeta | null {
  for (const scope of scopeStore.getAllScopes()) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue
    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const metaPath = getWorkflowDefMetaPath(scopeRoot, d.name)
        const meta = readMeta(metaPath)
        if (meta?.id === id) return meta
      }
    } catch {
      /* skip */
    }
  }
  return null
}

/**
 * 按定义 ID 更新 DefMeta（保证更新的是该 def 实际对应的 meta 文件，保持双向引用一致）
 */
export function updateDefMetaByDefId(
  id: string,
  patch: Partial<Pick<DefMeta, 'workflowManagementSessionId' | 'descriptionDocumentId'>>
): boolean {
  for (const scope of scopeStore.getAllScopes()) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue
    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const metaPath = getWorkflowDefMetaPath(scopeRoot, d.name)
        const existing = readMeta(metaPath)
        if (existing?.id !== id) continue
        const updated: DefMeta = { ...existing, ...patch, updatedAt: Date.now() }
        writeMeta(metaPath, updated)
        return true
      }
    } catch {
      /* skip */
    }
  }
  return false
}

/**
 * 删除会话时清除所有指向该 sessionId 的 def meta 引用，避免死数据（工作流指向已删除的管理会话）
 */
export function clearDefMetaSessionRef(sessionId: string): number {
  let cleared = 0
  for (const scope of scopeStore.getAllScopes()) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue
    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const metaPath = getWorkflowDefMetaPath(scopeRoot, d.name)
        const existing = readMeta(metaPath)
        if (existing?.workflowManagementSessionId !== sessionId) continue
        const updated: DefMeta = {
          ...existing,
          workflowManagementSessionId: undefined,
          updatedAt: Date.now()
        }
        writeMeta(metaPath, updated)
        cleared++
        log.info('Cleared workflow def meta session ref:', d.name, 'was', sessionId)
      }
    } catch {
      /* skip */
    }
  }
  return cleared
}

/**
 * 更新工作流的 DefMeta 部分字段（merge 语义，按 name+scope）
 */
export function updateDefMeta(
  name: string,
  scope: string,
  patch: Partial<Pick<DefMeta, 'workflowManagementSessionId' | 'descriptionDocumentId'>>
): void {
  const scopeRoot = scopeStore.getScopeRootPath(scope)
  const dirName = workflowDirName(name)
  const metaPath = getWorkflowDefMetaPath(scopeRoot, dirName)
  const existing = readMeta(metaPath)
  if (!existing) {
    log.warn('Cannot update DefMeta: not found for', name)
    return
  }
  const updated: DefMeta = { ...existing, ...patch, updatedAt: Date.now() }
  writeMeta(metaPath, updated)
}

// ─── 版本管理（无记忆功能，仅快照与回溯） ───

/**
 * 列出某工作流定义的版本列表（按时间倒序，最新在前）
 */
export function listDefVersions(defId: string): WorkflowDefVersionItem[] {
  const def = getDefById(defId)
  if (!def) return []

  const scopeRoot = scopeStore.getScopeRootPath(def.scope)
  const versionsDir = getWorkflowDefVersionsDir(scopeRoot, def.name)
  if (!fs.existsSync(versionsDir)) return []

  try {
    const files = fs.readdirSync(versionsDir, { withFileTypes: true })
    const items: WorkflowDefVersionItem[] = []
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.yaml')) continue
      const id = f.name.slice(0, -5)
      const num = parseInt(id, 10)
      const createdAt = Number.isFinite(num)
        ? num
        : fs.statSync(path.join(versionsDir, f.name)).mtimeMs
      items.push({ id, createdAt })
    }
    items.sort((a, b) => b.createdAt - a.createdAt)
    return items
  } catch (err) {
    log.warn('Failed to list workflow def versions:', defId, err)
    return []
  }
}

/**
 * 获取指定版本快照的 YAML 内容
 */
export function getDefVersionContent(defId: string, versionId: string): string | null {
  const def = getDefById(defId)
  if (!def) return null

  const versionPath = getWorkflowDefVersionPath(
    scopeStore.getScopeRootPath(def.scope),
    def.name,
    versionId
  )
  if (!fs.existsSync(versionPath)) return null

  try {
    return fs.readFileSync(versionPath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 回溯到指定版本：将该版本的 YAML 写回当前定义（会触发一次版本快照，当前内容被保存）
 */
export function rollbackDefToVersion(defId: string, versionId: string): WorkflowDefRecord | null {
  const def = getDefById(defId)
  if (!def) return null

  const yamlContent = getDefVersionContent(defId, versionId)
  if (!yamlContent) return null

  return registerDef(def.name, def.scope, yamlContent, def.description, def.triggersJson)
}

export function deleteDef(id: string): boolean {
  for (const scope of scopeStore.getAllScopes()) {
    const scopeRoot = scopeStore.getScopeRootPath(scope)
    const workflowsDir = getWorkflowsDir(scopeRoot)
    if (!fs.existsSync(workflowsDir)) continue

    try {
      const dirs = fs.readdirSync(workflowsDir, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        const metaPath = getWorkflowDefMetaPath(scopeRoot, d.name)
        const meta = readMeta(metaPath)
        if (meta?.id !== id) continue

        const workflowDir = path.join(workflowsDir, d.name)
        if (fs.existsSync(workflowDir)) {
          fs.rmSync(workflowDir, { recursive: true, force: true })
        }
        log.info('Deleted workflow def (dir removed):', d.name, 'scope:', scope)
        return true
      }
    } catch (err) {
      log.warn('deleteDef failed for scope:', scope, err)
    }
  }
  return false
}
