import { describe, it, expect } from 'vitest'
import { UnifiedExtractor } from './UnifiedExtractor.js'
import type { ICompletionProvider } from '../utils/llm.js'
import type { MemCell } from '../types.js'
import { RawDataType } from '../types.js'

/** 模拟默认模型返回的统一抽取格式（PROFILE 使用 ITEM 原子画像） */
const mockUnifiedModelOutput = `
## NARRATIVE
CONTENT: 用户讨论了项目进度与下周计划，约定周三前完成设计稿。
SUMMARY: 讨论项目进度与下周计划。
KEYWORDS: 项目, 进度, 设计稿

## EVENT_LOG
TIME: 2025-02-15
FACT: 用户提出周三前完成设计稿。
FACT: 约定下周一下午开会评审。

## FORESIGHT
CONTENT: 周三前需交付设计稿
START: 2025-02-15
END: 2025-02-19
EVIDENCE: 用户说「周三前把设计稿给我」
---
CONTENT: 下周一下午进行评审会议
START: 2025-02-17
END: 2025-02-17
EVIDENCE: 约定下周一下午开会评审

## PROFILE
ITEM: 用户名叫张三
ITEM: 用户擅长 TypeScript 和 Node.js
ITEM: 用户负责前端开发与需求对接
ITEM: 用户注重协作
ITEM: 用户热爱技术分享
ITEM: 用户行事风格务实
`

/** 模拟默认模型：收到抽取 prompt 后返回上述统一格式文本 */
const createMockDefaultModel = (): ICompletionProvider => ({
  async generate() {
    return mockUnifiedModelOutput
  },
  async getEmbedding() {
    return new Array(256).fill(0)
  }
})

/** 模拟对话数据（与 MemCell.original_data 一致） */
const simulatedConversation = [
  {
    role: 'user',
    content: '我这边项目进度想跟你对齐下，周三前能把设计稿给我吗？',
    timestamp: '2025-02-15T10:00:00.000Z'
  },
  {
    role: 'assistant',
    content: '可以，我周三前完成。下周一下午我们开个评审会吧。',
    timestamp: '2025-02-15T10:01:00.000Z'
  },
  {
    role: 'user',
    content: '行，我主要用 TypeScript 和 Node，你那边协作方式按现有流程来。',
    timestamp: '2025-02-15T10:02:00.000Z'
  }
]

function buildMemCell(overrides: Partial<MemCell> = {}): MemCell {
  return {
    event_id: 'ev-integration-1',
    user_id: 'user-001',
    type: RawDataType.CONVERSATION,
    original_data: simulatedConversation,
    timestamp: new Date().toISOString(),
    deleted: false,
    ...overrides
  }
}

describe('UnifiedExtractor 集成：模拟对话 + 默认模型输出', () => {
  it('使用模拟对话数据进行记忆抽取和解析，全流程跑通', async () => {
    const mockModel = createMockDefaultModel()
    const extractor = new UnifiedExtractor(mockModel)
    const memcell = buildMemCell()

    const result = await extractor.extractAll(memcell)

    expect(result).not.toBeNull()
    expect(result!.narrative).toBeDefined()
    expect(result!.narrative!.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result!.narrative!.summary).toBe('讨论项目进度与下周计划。')
    expect(result!.narrative!.keywords).toEqual(['项目', '进度', '设计稿'])

    expect(result!.event_log).toBeDefined()
    expect(result!.event_log!.time).toBe('2025-02-15')
    expect(result!.event_log!.atomic_fact).toHaveLength(2)
    expect(result!.event_log!.atomic_fact).toContain('用户提出周三前完成设计稿。')
    expect(result!.event_log!.atomic_fact).toContain('约定下周一下午开会评审。')

    expect(result!.foresight).toHaveLength(2)
    expect(result!.foresight![0].content).toBe('周三前需交付设计稿')
    expect(result!.foresight![0].evidence).toBe('用户说「周三前把设计稿给我」')
    expect(result!.foresight![1].content).toBe('下周一下午进行评审会议')

    expect(result!.profile).toBeDefined()
    expect(result!.profile!.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.user_name).toBeUndefined()
    const items = p.items as string[]
    expect(items).toHaveLength(6)
    expect(items).toContain('用户名叫张三')
    expect(items).toContain('用户擅长 TypeScript 和 Node.js')
    expect(items).toContain('用户负责前端开发与需求对接')
  })

  it('MemCell 仅含 text 时也能跑通（formatInputText 走 text 分支）', async () => {
    const mockModel = createMockDefaultModel()
    const extractor = new UnifiedExtractor(mockModel)
    const memcell = buildMemCell({
      original_data: undefined,
      text: 'User: 明天开会。\nAssistant: 好的，下午两点。'
    })

    const result = await extractor.extractAll(memcell)

    expect(result).not.toBeNull()
    expect(result!.narrative).toBeDefined()
    expect(result!.event_log).toBeDefined()
    expect(result!.foresight).toBeDefined()
    expect(result!.profile).toBeDefined()
  })

  it('original_data 为空数组时 extractAll 返回 null（无输入文本）', async () => {
    const mockModel = createMockDefaultModel()
    const extractor = new UnifiedExtractor(mockModel)
    const memcell = buildMemCell({ original_data: [], text: undefined })

    const result = await extractor.extractAll(memcell)

    expect(result).toBeNull()
  })
})
