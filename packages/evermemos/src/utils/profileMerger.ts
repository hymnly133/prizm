import { parseJSON } from './llm.js'
import { PROFILE_MERGE_PROMPT } from '../prompts.js'

/** Minimal LLM interface needed by the profile merger (subset of ICompletionProvider) */
export interface IProfileMergeLLM {
  generate(request: {
    prompt: string
    temperature?: number
    json?: boolean
    operationTag?: string
  }): Promise<string>
}

/**
 * Profile 增量合并器 — 纯原子事实列表模式。
 *
 * 存储结构：{ items: string[] }
 * - items: 字符串数组去重合并（normalize 后比较 / LLM 语义去重）
 *
 * 不区分用户，系统只维护一份画像。
 * 称呼偏好作为 items 中的普通原子事实（如"用户希望被称为老大"）。
 */

export interface MergeResult {
  merged: Record<string, unknown>
  /** 描述合并发生了什么变化（可读文本） */
  changesSummary: string
  /** 是否有实质性变化（若无变化可跳过更新） */
  hasChanges: boolean
}

/**
 * 不使用 LLM 的简单合并（快速路径）。
 * 规则：items 字符串数组去重合并（normalize 后比较）
 */
export function mergeProfilesSimple(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): MergeResult {
  const merged: Record<string, unknown> = { ...existing }
  const changes: string[] = []
  let hasChanges = false

  const oldItems = Array.isArray(existing.items) ? (existing.items as string[]) : []
  const newItems = Array.isArray(incoming.items) ? (incoming.items as string[]) : []

  if (newItems.length > 0) {
    const existingNormalized = new Set(oldItems.map((s) => normalizeItem(s)))
    const added: string[] = []
    for (const item of newItems) {
      const normalized = normalizeItem(item)
      if (normalized && !existingNormalized.has(normalized)) {
        added.push(item)
        existingNormalized.add(normalized)
      }
    }
    if (added.length > 0) {
      merged.items = [...oldItems, ...added]
      changes.push(`items: +${added.length} new facts`)
      hasChanges = true
    }
  }

  return {
    merged,
    changesSummary: changes.length > 0 ? changes.join('; ') : 'No changes',
    hasChanges
  }
}

/**
 * 使用 LLM 进行智能 Profile 合并（高质量路径）。
 * LLM 负责：语义去重、冲突解决、信息整合。
 * 如果 LLM 调用失败，自动降级到 `mergeProfilesSimple`。
 */
export async function mergeProfilesWithLLM(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  llm: IProfileMergeLLM
): Promise<MergeResult> {
  const existingStr = JSON.stringify(filterProfileFields(existing), null, 2)
  const incomingStr = JSON.stringify(filterProfileFields(incoming), null, 2)

  const prompt = PROFILE_MERGE_PROMPT.replace('{{EXISTING_PROFILE}}', existingStr).replace(
    '{{INCOMING_PROFILE}}',
    incomingStr
  )

  try {
    const response = await llm.generate({
      prompt,
      temperature: 0,
      json: true,
      operationTag: 'memory:profile_merge'
    })

    const parsed = parseJSON(response)
    if (!parsed || typeof parsed !== 'object') {
      return mergeProfilesSimple(existing, incoming)
    }

    const mergedProfile = parsed.merged_profile ?? parsed
    const changeSummary =
      typeof parsed.changes_summary === 'string' ? parsed.changes_summary : 'LLM merged profile'

    const result: Record<string, unknown> = { ...existing }

    // items — LLM 返回去重/整合后的数组
    if (Array.isArray(mergedProfile.items) && mergedProfile.items.length > 0) {
      result.items = mergedProfile.items
    }

    const hasChanges =
      JSON.stringify(filterProfileFields(result)) !== JSON.stringify(filterProfileFields(existing))

    return { merged: result, changesSummary: changeSummary, hasChanges }
  } catch (e) {
    console.warn('[ProfileMerger] LLM merge failed, falling back to simple merge:', e)
    return mergeProfilesSimple(existing, incoming)
  }
}

/** Normalize item text for dedup comparison */
function normalizeItem(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?]+/g, ' ')
    .trim()
}

/** Extract only profile-relevant fields for comparison */
function filterProfileFields(profile: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (profile.items != null) {
    result.items = profile.items
  }
  return result
}
