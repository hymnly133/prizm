import type { UnifiedExtractionResult } from '../types.js'

const SECTION_RE = /^##\s*(\w+)\s*$/gm

function parseSectionKeyValues(body: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toUpperCase()
    const value = line.slice(colon + 1).trim()
    if (!value) continue
    const existing = map.get(key) ?? []
    existing.push(value)
    map.set(key, existing)
  }
  return map
}

function getFirst(map: Map<string, string[]>, key: string): string | undefined {
  return map.get(key)?.[0]
}

function getAll(map: Map<string, string[]>, key: string): string[] {
  return map.get(key) ?? []
}

/**
 * 解析统一记忆抽取的纯文本输出（## 分段 + KEY: value），避免 JSON 解析错误。
 */
export function parseUnifiedMemoryText(text: string): UnifiedExtractionResult | null {
  if (!text || typeof text !== 'string') return null
  const normalized = text.trim()
  const matches: Array<{ name: string; headerStart: number; bodyStart: number }> = []
  let m: RegExpExecArray | null
  SECTION_RE.lastIndex = 0
  while ((m = SECTION_RE.exec(normalized)) !== null) {
    matches.push({
      name: m[1].toUpperCase(),
      headerStart: m.index,
      bodyStart: m.index + m[0].length
    })
  }
  const sections = new Map<string, string>()
  for (let i = 0; i < matches.length; i++) {
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].headerStart : normalized.length
    const body = normalized.slice(matches[i].bodyStart, bodyEnd).trim()
    sections.set(matches[i].name, body)
  }

  const result: UnifiedExtractionResult = {}

  // 支持 ## NARRATIVE 或旧格式 ## EPISODE
  const narrativeBody = sections.get('NARRATIVE') ?? sections.get('EPISODE')
  if (narrativeBody) {
    const kv = parseSectionKeyValues(narrativeBody)
    const content = getFirst(kv, 'CONTENT')
    if (content) {
      result.narrative = {
        content,
        summary: getFirst(kv, 'SUMMARY') || content.slice(0, 200),
        keywords: getFirst(kv, 'KEYWORDS')
          ? getFirst(kv, 'KEYWORDS')!
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
      }
    }
  }

  const eventBody = sections.get('EVENT_LOG')
  if (eventBody) {
    const kv = parseSectionKeyValues(eventBody)
    const facts = getAll(kv, 'FACT').filter(Boolean)
    if (facts.length) {
      result.event_log = {
        time: getFirst(kv, 'TIME'),
        atomic_fact: facts.slice(0, 10)
      }
    }
  }

  const foresightBody = sections.get('FORESIGHT')
  if (foresightBody) {
    const blocks = foresightBody
      .split(/\s*---\s*/)
      .map((b) => b.trim())
      .filter(Boolean)
    const items: UnifiedExtractionResult['foresight'] = []
    for (const block of blocks.slice(0, 10)) {
      const kv = parseSectionKeyValues(block)
      const content = getFirst(kv, 'CONTENT')
      if (content) {
        items.push({
          content,
          start_time: getFirst(kv, 'START'),
          end_time: getFirst(kv, 'END'),
          evidence: getFirst(kv, 'EVIDENCE')
        })
      }
    }
    if (items.length) result.foresight = items
  }

  const profileBody = sections.get('PROFILE')
  if (profileBody) {
    const kv = parseSectionKeyValues(profileBody)
    const items = getAll(kv, 'ITEM').filter(Boolean)

    // 输出格式：{ items: string[] }
    // 每条 ITEM 是一个原子画像事实（包括称呼偏好），同一用户的所有 ITEM 合并到一条 profile 记录
    if (items.length > 0) {
      result.profile = { user_profiles: [{ items }] }
    }
  }

  // 文档场景：## OVERVIEW 映射到 narrative.content，## FACTS 映射到 event_log.atomic_fact
  const overviewBody = sections.get('OVERVIEW')
  if (overviewBody && !result.narrative) {
    const kv = parseSectionKeyValues(overviewBody)
    const content = getFirst(kv, 'CONTENT')
    if (content) {
      result.narrative = { content, summary: content.slice(0, 200) }
    }
  }

  const factsBody = sections.get('FACTS')
  if (factsBody && !result.event_log) {
    const kv = parseSectionKeyValues(factsBody)
    const facts = getAll(kv, 'FACT').filter(Boolean)
    if (facts.length) {
      result.event_log = {
        time: new Date().toISOString().slice(0, 10),
        atomic_fact: facts.slice(0, 20)
      }
    }
  }

  if (
    !result.narrative &&
    !result.event_log?.atomic_fact?.length &&
    !result.foresight?.length &&
    !result.profile?.user_profiles?.length
  ) {
    return null
  }
  return result
}

/**
 * 解析迁移记忆抽取文本（## MIGRATION 段），返回变更条目列表。
 */
export function parseMigrationText(text: string): string[] {
  if (!text || typeof text !== 'string') return []
  const normalized = text.trim()
  const matches: Array<{ name: string; headerStart: number; bodyStart: number }> = []
  let m: RegExpExecArray | null
  const re = /^##\s*(\w+)\s*$/gm
  while ((m = re.exec(normalized)) !== null) {
    matches.push({
      name: m[1].toUpperCase(),
      headerStart: m.index,
      bodyStart: m.index + m[0].length
    })
  }
  const sections = new Map<string, string>()
  for (let i = 0; i < matches.length; i++) {
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].headerStart : normalized.length
    const body = normalized.slice(matches[i].bodyStart, bodyEnd).trim()
    sections.set(matches[i].name, body)
  }

  const migrationBody = sections.get('MIGRATION')
  if (!migrationBody) return []

  const kv = parseSectionKeyValues(migrationBody)
  return getAll(kv, 'CHANGE').filter(Boolean).slice(0, 10)
}
