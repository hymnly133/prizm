/**
 * Context Budget Manager — 统一上下文预算分配与裁剪
 *
 * 将 scopeContext、记忆注入、对话历史等合并为统一的 budget 分配流程，
 * 当总量超出 available token 时按优先级自动裁剪。
 */

import { createLogger } from '../../logger'
import type {
  BudgetAllocation,
  ContextBudgetConfig,
  ContextBudgetSnapshot,
} from './types'
import { TRIM_PRIORITIES } from './types'

const log = createLogger('ContextBudget')

/** 默认上下文预算配置（保守估计，适用于 8K 模型） */
const DEFAULT_CONFIG: ContextBudgetConfig = {
  totalTokens: 8192,
  systemPromptReserved: 800,
  toolDefinitionsReserved: 1500,
  responseBufferReserved: 1500
}

/** 粗略 token 估算（中文约 2 字符/token，英文约 4 字符/token） */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjkChars = 0
  let otherChars = 0
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2e80) {
      cjkChars++
    } else {
      otherChars++
    }
  }
  return Math.ceil(cjkChars / 2 + otherChars / 4)
}

/**
 * 创建上下文预算管理器实例
 */
export function createContextBudget(
  config?: Partial<ContextBudgetConfig>
): ContextBudgetInstance {
  return new ContextBudgetInstance({ ...DEFAULT_CONFIG, ...config })
}

class ContextBudgetInstance {
  private config: ContextBudgetConfig
  private allocations = new Map<string, BudgetAllocation>()

  constructor(config: ContextBudgetConfig) {
    this.config = config
  }

  /** 可分配的总 token */
  get available(): number {
    return Math.max(
      0,
      this.config.totalTokens -
        this.config.systemPromptReserved -
        this.config.toolDefinitionsReserved -
        this.config.responseBufferReserved
    )
  }

  /** 当前已使用的 token */
  get used(): number {
    let total = 0
    for (const alloc of this.allocations.values()) total += alloc.used
    return total
  }

  /** 剩余可用 token */
  get remaining(): number {
    return Math.max(0, this.available - this.used)
  }

  /**
   * 注册一个分配区域
   */
  register(name: string, content: string, trimPriority: number, maxTokens?: number): void {
    const tokens = estimateTokens(content)
    const max = maxTokens ?? tokens
    this.allocations.set(name, {
      name,
      max,
      used: tokens,
      trimPriority
    })
  }

  /**
   * 执行裁剪：如果总 used 超出 available，按优先级从高到低裁剪
   * 返回需要裁剪的区域及裁剪比例
   */
  trim(): ContextBudgetSnapshot {
    const overBudget = this.used - this.available
    const trimDetails: Array<{ name: string; before: number; after: number }> = []

    if (overBudget <= 0) {
      return this.snapshot(false)
    }

    log.info(
      'Context budget over by %d tokens (used=%d, available=%d), trimming...',
      overBudget,
      this.used,
      this.available
    )

    // 按 trimPriority 降序排列（数值大的先裁剪）
    const sorted = [...this.allocations.values()].sort(
      (a, b) => b.trimPriority - a.trimPriority
    )

    let remaining = overBudget
    for (const alloc of sorted) {
      if (remaining <= 0) break
      if (alloc.used <= 0) continue

      const trimAmount = Math.min(alloc.used, remaining)
      const before = alloc.used
      alloc.used = Math.max(0, alloc.used - trimAmount)
      remaining -= trimAmount

      trimDetails.push({
        name: alloc.name,
        before,
        after: alloc.used
      })

      log.info(
        'Trimmed %s: %d -> %d tokens (priority=%d)',
        alloc.name,
        before,
        alloc.used,
        alloc.trimPriority
      )
    }

    return this.snapshot(true, trimDetails)
  }

  /**
   * 获取某个区域的裁剪后最大 token 数
   */
  getAllowedTokens(name: string): number {
    const alloc = this.allocations.get(name)
    return alloc?.used ?? 0
  }

  /**
   * 按预算裁剪文本内容
   */
  trimContent(name: string, content: string): string {
    const allowed = this.getAllowedTokens(name)
    const currentTokens = estimateTokens(content)
    if (currentTokens <= allowed) return content

    const ratio = allowed / currentTokens
    const charLimit = Math.floor(content.length * ratio)
    return content.slice(0, charLimit) + '\n…(已按上下文预算裁剪)'
  }

  private snapshot(
    trimmed: boolean,
    trimDetails?: Array<{ name: string; before: number; after: number }>
  ): ContextBudgetSnapshot {
    const allocations: Record<string, BudgetAllocation> = {}
    for (const [key, val] of this.allocations) {
      allocations[key] = { ...val }
    }
    return {
      config: { ...this.config },
      available: this.available,
      allocations,
      trimmed,
      trimDetails
    }
  }
}

/**
 * 预设区域名称常量
 */
export const BUDGET_AREAS = {
  USER_PROFILE: 'userProfile',
  SCOPE_CONTEXT: 'scopeContext',
  SCOPE_MEMORY: 'scopeMemory',
  SESSION_MEMORY: 'sessionMemory',
  DOCUMENT_MEMORY: 'documentMemory',
  CONVERSATION_HISTORY: 'conversationHistory',
  SKILL_RULES: 'skillRules'
} as const

export { TRIM_PRIORITIES }
