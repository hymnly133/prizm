/**
 * Agent Sessions (.prizm/agent-sessions/) CRUD + messages and session sub-files.
 */

import fs from 'fs'
import path from 'path'
import type { AgentSession, AgentMessage, MessagePart } from '../../types'
import {
  getAgentSessionsDir,
  getSessionDir,
  getSessionFilePath,
  getSessionSummaryPath,
  getSessionMemoriesPath,
  getSessionWorkspaceDir
} from '../PathProviderCore'
import {
  EXT,
  safeId,
  readMd,
  writeMd,
  ensureDir
} from './utils'

function parseMessagePart(p: unknown): MessagePart | null {
  if (!p || typeof p !== 'object') return null
  const x = p as Record<string, unknown>
  if (x.type === 'text' && typeof x.content === 'string') {
    return { type: 'text', content: x.content }
  }
  if (
    x.type === 'tool' &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.arguments === 'string' &&
    typeof x.result === 'string'
  ) {
    return {
      type: 'tool',
      id: x.id,
      name: x.name,
      arguments: x.arguments,
      result: x.result,
      ...(x.isError === true && { isError: true })
    }
  }
  return null
}

function parseAgentMessage(raw: unknown): AgentMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  const role = (
    r.role === 'user' || r.role === 'assistant' || r.role === 'system' ? r.role : 'user'
  ) as AgentMessage['role']
  const createdAt = (r.createdAt as number) ?? 0
  if (!id) return null

  let parts: MessagePart[] = []
  if (Array.isArray(r.parts) && r.parts.length > 0) {
    const parsed = r.parts
      .map(parseMessagePart)
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (parsed.length > 0) parts = parsed
  }
  if (parts.length === 0) {
    const content = typeof r.content === 'string' ? r.content : ''
    if (content.trim()) {
      parts.push({ type: 'text', content })
    }
    if (Array.isArray(r.toolCalls)) {
      for (const tc of r.toolCalls) {
        if (tc && typeof tc === 'object' && 'id' in tc && 'name' in tc) {
          const t = tc as Record<string, unknown>
          parts.push({
            type: 'tool',
            id: String(t.id ?? ''),
            name: String(t.name ?? ''),
            arguments:
              typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments ?? {}),
            result: typeof t.result === 'string' ? t.result : '',
            ...(t.isError === true && { isError: true }),
            ...(typeof t.status === 'string' && {
              status: t.status as 'preparing' | 'running' | 'awaiting_interact' | 'done'
            })
          })
        }
      }
    }
  }

  return {
    id,
    role,
    parts,
    createdAt,
    ...(typeof r.model === 'string' ? { model: r.model } : {}),
    ...(r.usage && typeof r.usage === 'object' ? { usage: r.usage as AgentMessage['usage'] } : {}),
    ...(typeof r.reasoning === 'string' ? { reasoning: r.reasoning } : {}),
    ...(r.memoryRefs && typeof r.memoryRefs === 'object'
      ? { memoryRefs: r.memoryRefs as AgentMessage['memoryRefs'] }
      : {})
  }
}

function parseAgentSession(
  fp: string,
  d: Record<string, unknown>,
  _content: string,
  sessionIdHint?: string
): AgentSession | null {
  const id = typeof d.id === 'string' ? d.id : sessionIdHint ?? path.basename(fp, EXT)
  const scope = typeof d.scope === 'string' ? d.scope : ''
  const createdAt = (d.createdAt as number) ?? 0
  const updatedAt = (d.updatedAt as number) ?? 0
  let messages: AgentMessage[] = []
  if (Array.isArray(d.messages) && d.messages.length > 0) {
    messages = d.messages.map(parseAgentMessage).filter((m): m is AgentMessage => m !== null)
  }
  messages.sort((a, b) => a.createdAt - b.createdAt)
  const llmSummary = typeof d.llmSummary === 'string' ? d.llmSummary : undefined
  const compressedThroughRound =
    typeof d.compressedThroughRound === 'number' ? d.compressedThroughRound : undefined
  const grantedPaths = Array.isArray(d.grantedPaths)
    ? (d.grantedPaths as unknown[]).filter((p): p is string => typeof p === 'string')
    : undefined
  return {
    id,
    scope,
    messages,
    createdAt,
    updatedAt,
    ...(llmSummary != null && { llmSummary }),
    ...(compressedThroughRound != null && { compressedThroughRound }),
    ...(grantedPaths && grantedPaths.length > 0 && { grantedPaths })
  }
}

function readSingleSession(
  scopeRoot: string,
  sessionIdOrPath: string,
  isDir: boolean
): AgentSession | null {
  let fp: string
  let sessionIdHint: string | undefined
  if (isDir) {
    fp = path.join(sessionIdOrPath, 'session.md')
    sessionIdHint = path.basename(sessionIdOrPath)
  } else {
    fp = sessionIdOrPath
  }
  const parsed = readMd(fp)
  if (!parsed) return null
  const session = parseAgentSession(fp, parsed.data, parsed.content, sessionIdHint)
  if (!session) return null
  const summary = readSessionSummary(scopeRoot, session.id)
  if (summary != null) {
    session.llmSummary = summary
  } else if (typeof parsed.data.llmSummary === 'string') {
    session.llmSummary = parsed.data.llmSummary
  }
  return session
}

export function readAgentSessions(scopeRoot: string): AgentSession[] {
  const dir = getAgentSessionsDir(scopeRoot)
  if (!fs.existsSync(dir)) return []

  const byId = new Map<string, AgentSession>()
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const e of entries) {
    const fullPath = path.join(dir, e.name)
    const isDir = e.isDirectory()
    if (isDir || (e.isFile() && e.name.endsWith(EXT))) {
      const session = readSingleSession(scopeRoot, fullPath, isDir)
      if (session) {
        if (isDir) byId.set(session.id, session)
        else if (!byId.has(session.id)) byId.set(session.id, session)
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function writeAgentSessions(
  scopeRoot: string,
  sessions: AgentSession[],
  scopeId?: string
): void {
  const dir = getAgentSessionsDir(scopeRoot)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const existingDirs = new Set<string>()
  const existingFiles = new Set<string>()
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) existingDirs.add(full)
    else if (e.isFile() && e.name.endsWith(EXT)) existingFiles.add(full)
  }

  const ids = new Set(sessions.map((s) => s.id))
  const scope = scopeId ?? ''

  for (const s of sessions) {
    const sessionDir = getSessionDir(scopeRoot, s.id)
    const sessionFilePath = getSessionFilePath(scopeRoot, s.id)
    ensureDir(path.dirname(sessionFilePath))

    const frontmatter: Record<string, unknown> = {
      prizm_type: 'agent_session',
      id: s.id,
      scope: scope || s.scope,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ...(s.compressedThroughRound != null && { compressedThroughRound: s.compressedThroughRound }),
      ...(s.grantedPaths?.length && { grantedPaths: s.grantedPaths }),
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt,
        ...(m.model && { model: m.model }),
        ...(m.usage && { usage: m.usage }),
        ...(m.reasoning && { reasoning: m.reasoning }),
        ...(m.memoryRefs && { memoryRefs: m.memoryRefs })
      }))
    }
    writeMd(sessionFilePath, frontmatter, '')
    if (s.llmSummary != null) {
      writeSessionSummary(scopeRoot, s.id, s.llmSummary)
    }
    existingDirs.delete(sessionDir)
    existingFiles.delete(path.join(dir, `${safeId(s.id)}${EXT}`))
  }

  for (const d of existingDirs) {
    try {
      fs.rmSync(d, { recursive: true })
    } catch {}
  }
  for (const f of existingFiles) {
    try {
      fs.unlinkSync(f)
    } catch {}
  }
}

// ============ Session 级子文件 ============

export function readSessionSummary(scopeRoot: string, sessionId: string): string | null {
  const fp = getSessionSummaryPath(scopeRoot, sessionId)
  const parsed = readMd(fp)
  if (!parsed || !parsed.content.trim()) return null
  return parsed.content.trim()
}

export function writeSessionSummary(
  scopeRoot: string,
  sessionId: string,
  summary: string
): void {
  const fp = getSessionSummaryPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  writeMd(fp, { prizm_type: 'agent_session_summary' }, summary)
}

export function readSessionMemories(scopeRoot: string, sessionId: string): string {
  const fp = getSessionMemoriesPath(scopeRoot, sessionId)
  if (!fs.existsSync(fp)) return ''
  try {
    return fs.readFileSync(fp, 'utf-8')
  } catch {
    return ''
  }
}

export function appendSessionMemories(
  scopeRoot: string,
  sessionId: string,
  content: string
): void {
  const fp = getSessionMemoriesPath(scopeRoot, sessionId)
  ensureDir(path.dirname(fp))
  const existing = readSessionMemories(scopeRoot, sessionId)
  const separator = existing ? '\n\n---\n\n' : ''
  fs.appendFileSync(fp, separator + content, 'utf-8')
}

export function deleteSessionDir(scopeRoot: string, sessionId: string): void {
  const dir = getSessionDir(scopeRoot, sessionId)
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true })
    } catch {}
  }
}

/** 确保会话临时工作区目录存在 */
export function ensureSessionWorkspace(scopeRoot: string, sessionId: string): string {
  const dir = getSessionWorkspaceDir(scopeRoot, sessionId)
  ensureDir(dir)
  return dir
}
