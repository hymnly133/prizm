/**
 * chatCore — 记忆注入逻辑
 *
 * 将用户画像、工作区记忆、会话记忆注入到 history 消息数组中。
 */

import type { MemoryItem, MemoryIdsByLayer, MemoryInjectPolicy } from '@prizm/shared'
import {
  isMemoryEnabled,
  listAllUserProfiles,
  searchUserAndScopeMemories,
  searchThreeLevelMemories,
  updateMemoryRefStats
} from '../../../llm/EverMemService'
import { getUserProfile } from '../../../settings/userProfileStore'
import { executePreMemoryInjectHooks } from '../../../core/agentHooks'
import { createLogger } from '../../../logger'

const log = createLogger('ChatCore:Memory')

const MAX_CHARS_CONTEXT = 200
function truncateMem(s: string, max = MAX_CHARS_CONTEXT): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}

export interface MemoryInjectionInput {
  scope: string
  sessionId: string
  content: string
  compressedThrough: number
  isFirstMessage: boolean
  skipMemory: boolean
  /** 当前请求的 clientId，用于注入该客户端的用户画像（displayName / preferredTone） */
  clientId?: string
  memInjectPolicy?: MemoryInjectPolicy
}

export interface MemoryInjectionResult {
  injectedMemories: {
    user: MemoryItem[]
    scope: MemoryItem[]
    session: MemoryItem[]
  } | null
  injectedIds: MemoryIdsByLayer
  /**
   * 记忆系统消息文本（画像 + 上下文记忆），
   * 由调用方注入到消息末尾的动态区而非 history 中间。
   */
  memorySystemTexts: string[]
}

/**
 * 构建用户画像 + 上下文记忆文本。
 * 不再修改 history，而是返回待注入的文本列表。
 * 调用方负责将其放入消息数组末尾的动态区。
 */
export async function injectMemories(input: MemoryInjectionInput): Promise<MemoryInjectionResult> {
  const {
    scope,
    sessionId,
    content,
    compressedThrough,
    isFirstMessage,
    skipMemory,
    clientId,
    memInjectPolicy
  } = input

  const trimmedContent = content.trim()
  const memoryEnabled = !skipMemory && isMemoryEnabled()

  let injectedMemoriesForClient: MemoryInjectionResult['injectedMemories'] = null
  let injectedIds: MemoryIdsByLayer = { user: [], scope: [], session: [] }
  const memorySystemTexts: string[] = []

  const shouldInjectProfile = memInjectPolicy?.injectProfile !== false

  const profileLines: string[] = []
  if (memoryEnabled && shouldInjectProfile && clientId) {
    try {
      const storeProfile = getUserProfile(clientId)
      if (storeProfile?.displayName?.trim()) {
        profileLines.push(`- 用户希望被称呼为：${storeProfile.displayName.trim()}`)
      }
      if (storeProfile?.preferredTone?.trim()) {
        profileLines.push(`- 希望助手语气：${storeProfile.preferredTone.trim()}`)
      }
    } catch (storeErr) {
      log.warn('User profile store read failed:', storeErr)
    }
  }

  let profileMem: MemoryItem[] = []
  if (memoryEnabled && shouldInjectProfile) {
    try {
      profileMem = await listAllUserProfiles()
      if (profileMem.length > 0) {
        profileMem.forEach((m) => profileLines.push(`- ${m.memory}`))
      }
      if (profileLines.length > 0) {
        const profilePrompt =
          '【用户画像 — 只读，由系统自动维护】\n' +
          profileLines.join('\n') +
          '\n\n严格遵守以上画像中的称呼和偏好。画像由记忆系统自动更新，不要为此创建文档。'
        memorySystemTexts.push(profilePrompt)
        log.info('Injected user profile: %d items (store + memory)', profileLines.length)
      }
    } catch (profileErr) {
      if (profileLines.length > 0) {
        const profilePrompt =
          '【用户画像 — 只读，由系统自动维护】\n' +
          profileLines.join('\n') +
          '\n\n严格遵守以上画像中的称呼和偏好。'
        memorySystemTexts.push(profilePrompt)
      }
      log.warn('User profile loading failed, proceeding without:', profileErr)
    }
  } else if (profileLines.length > 0) {
    const profilePrompt =
      '【用户画像 — 只读，由系统自动维护】\n' +
      profileLines.join('\n') +
      '\n\n严格遵守以上画像中的称呼和偏好。'
    memorySystemTexts.push(profilePrompt)
  }

  const shouldInjectContextMemory =
    memoryEnabled && (trimmedContent.length >= 4 || (isFirstMessage && trimmedContent.length >= 1))
  const memoryQuery =
    memInjectPolicy?.customQuery ??
    (trimmedContent.length >= 4 ? trimmedContent : '用户偏好与工作区概况')

  if (shouldInjectContextMemory) {
    try {
      const two = await searchUserAndScopeMemories(memoryQuery, scope)
      let scopeMem = two.scope
      let sessionMem: MemoryItem[] = []
      if (compressedThrough > 0) {
        const three = await searchThreeLevelMemories(memoryQuery, scope, sessionId)
        sessionMem = three.session
      }

      if (memInjectPolicy?.allowedTypes?.length) {
        const allowed = new Set(memInjectPolicy.allowedTypes)
        scopeMem = scopeMem.filter((m) => allowed.has(m.memory_type ?? ''))
        sessionMem = sessionMem.filter((m) => allowed.has(m.memory_type ?? ''))
      }
      if (memInjectPolicy?.maxInjectCount !== undefined) {
        const max = memInjectPolicy.maxInjectCount
        scopeMem = scopeMem.slice(0, max)
        sessionMem = sessionMem.slice(0, max)
      }

      const preMemDecision = await executePreMemoryInjectHooks({
        scope,
        sessionId,
        query: memoryQuery,
        memories: { user: profileMem, scope: scopeMem, session: sessionMem }
      })
      if (preMemDecision.filteredMemories) {
        scopeMem = preMemDecision.filteredMemories.scope
        sessionMem = preMemDecision.filteredMemories.session
      }

      const foresightMem = scopeMem.filter((m) => m.memory_type === 'foresight')
      const docMem = scopeMem.filter(
        (m) => m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
      )
      const episodicMem = scopeMem.filter(
        (m) => !m.group_id?.endsWith(':docs') && m.memory_type !== 'foresight'
      )

      const sections: string[] = []

      if (episodicMem.length > 0) {
        const lines = episodicMem.map((m, i) => {
          const date = m.created_at ? m.created_at.slice(0, 10) : ''
          const dateTag = date ? ` (${date})` : ''
          return `  [${i + 1}]${dateTag} ${truncateMem(m.memory)}`
        })
        sections.push('【相关记忆】\n' + lines.join('\n'))
      }

      if (foresightMem.length > 0) {
        sections.push(
          '【前瞻/意图】\n' + foresightMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
        )
      }

      if (docMem.length > 0) {
        sections.push(
          '【文档记忆】\n' + docMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
        )
      }

      if (sessionMem.length > 0) {
        sections.push(
          '【会话记忆】\n' + sessionMem.map((m) => `  - ${truncateMem(m.memory)}`).join('\n')
        )
      }

      if (sections.length > 0 || profileMem.length > 0) {
        injectedMemoriesForClient = {
          user: profileMem,
          scope: scopeMem,
          session: sessionMem
        }
        if (sections.length > 0) {
          memorySystemTexts.push(sections.join('\n\n'))
        }
        log.info(
          'Injected memories: profile=%d, episodic=%d, foresight=%d, doc=%d, session=%d',
          profileMem.length,
          episodicMem.length,
          foresightMem.length,
          docMem.length,
          sessionMem.length
        )
      }
    } catch (memErr) {
      log.warn('Memory search failed, proceeding without:', memErr)
    }
  }

  if (!injectedMemoriesForClient && profileMem.length > 0) {
    injectedMemoriesForClient = { user: profileMem, scope: [], session: [] }
  }

  if (injectedMemoriesForClient) {
    injectedIds = {
      user: injectedMemoriesForClient.user.map((m) => m.id),
      scope: injectedMemoriesForClient.scope.map((m) => m.id),
      session: injectedMemoriesForClient.session.map((m) => m.id)
    }
    updateMemoryRefStats(injectedIds, scope).catch((e) => log.warn('ref stats update failed:', e))
  }

  return { injectedMemories: injectedMemoriesForClient, injectedIds, memorySystemTexts }
}
