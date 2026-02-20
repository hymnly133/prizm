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
import { createLogger } from '../../logger'
import { genUniqueId } from '../../id'
import {
  getWorkflowsDir,
  getWorkflowDefPath,
  getWorkflowDefMetaPath,
  ensureWorkflowWorkspace,
  workflowDirName
} from '../PathProviderCore'
import { scopeStore } from '../ScopeStore'
import type { WorkflowDefRecord } from '@prizm/shared'

const log = createLogger('WorkflowDefStore')

interface DefMeta {
  id: string
  createdAt: number
  updatedAt: number
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
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DefMeta
  } catch {
    return null
  }
}

function writeMeta(metaPath: string, meta: DefMeta): void {
  const dir = path.dirname(metaPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

function extractYamlFields(yamlContent: string): { name?: string; description?: string; triggersJson?: string } {
  try {
    const yaml = require('js-yaml')
    const parsed = yaml.load(yamlContent)
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      triggersJson: parsed.triggers ? JSON.stringify(parsed.triggers) : undefined
    }
  } catch {
    return {}
  }
}

function readDefFromDisk(scopeRoot: string, dirName: string, scope: string): WorkflowDefRecord | null {
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
      updatedAt
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

  const existingMeta = readMeta(metaPath)
  const now = Date.now()
  const meta: DefMeta = {
    id: existingMeta?.id ?? genUniqueId(),
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now
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
    updatedAt: meta.updatedAt
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
    } catch { /* skip inaccessible dirs */ }
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

        const defPath = getWorkflowDefPath(scopeRoot, d.name)
        if (fs.existsSync(defPath)) fs.unlinkSync(defPath)
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
        log.info('Deleted workflow def:', d.name, 'scope:', scope)
        return true
      }
    } catch { /* skip */ }
  }
  return false
}
