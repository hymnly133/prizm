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

  const episodeBody = sections.get('EPISODE')
  if (episodeBody) {
    const kv = parseSectionKeyValues(episodeBody)
    const content = getFirst(kv, 'CONTENT')
    if (content) {
      result.episode = {
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
    for (const block of blocks.slice(0, 5)) {
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
    const userId = getFirst(kv, 'USER_ID')
    if (userId) {
      const record: Record<string, unknown> = {
        user_id: userId,
        user_name: getFirst(kv, 'USER_NAME'),
        hard_skills: getFirst(kv, 'HARD_SKILLS')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        soft_skills: getFirst(kv, 'SOFT_SKILLS')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        output_reasoning: getFirst(kv, 'OUTPUT_REASONING'),
        work_responsibility: getFirst(kv, 'WORK_RESPONSIBILITY')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        interests: getFirst(kv, 'INTERESTS')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        tendency: getFirst(kv, 'TENDENCY')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      result.profile = { user_profiles: [record] }
    }
  }

  if (
    !result.episode &&
    !result.event_log?.atomic_fact?.length &&
    !result.foresight?.length &&
    !result.profile?.user_profiles?.length
  ) {
    return null
  }
  return result
}
