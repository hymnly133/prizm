import { describe, it, expect } from 'vitest'
import { UnifiedExtractor } from './UnifiedExtractor.js'
import type { ICompletionProvider } from '../utils/llm.js'
import type { MemCell } from '../types.js'
import { RawDataType } from '../types.js'

const mockPerRoundOutput = `
## EVENT_LOG
FACT: 用户提出周三前完成设计稿。
FACT: 约定下周一下午开会评审。

## FORESIGHT
CONTENT: 周三前需交付设计稿
EVIDENCE: 用户说「周三前把设计稿给我」
---
CONTENT: 下周一下午进行评审会议
EVIDENCE: 约定下周一下午开会评审

## PROFILE
ITEM: 用户名叫张三
ITEM: 用户擅长 TypeScript 和 Node.js
ITEM: 用户负责前端开发与需求对接
`

const mockNarrativeBatchOutput = `
## NARRATIVE
CONTENT: 用户讨论了项目进度与下周计划，约定周三前完成设计稿。
SUMMARY: 讨论项目进度与下周计划。
---
CONTENT: 用户介绍了技术栈选型和团队协作方式。
SUMMARY: 技术栈与协作方式讨论。

## FORESIGHT
CONTENT: 用户可能在下周启动新的前端模块开发
EVIDENCE: 用户提到周三交稿后开始新模块

## PROFILE
ITEM: 用户注重协作
ITEM: 用户热爱技术分享
`

const mockDocumentOutput = `
## OVERVIEW
CONTENT: 本文档介绍了项目架构设计，包括前端技术栈选型和后端服务拆分方案。

## FACTS
FACT: 项目采用 React 18 + TypeScript 作为前端技术栈。
FACT: 后端服务拆分为用户服务、订单服务和通知服务。
`

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

describe('UnifiedExtractor Pipeline 集成测试', () => {
  describe('extractPerRound (Pipeline 1)', () => {
    const createMockModel = (): ICompletionProvider => ({
      async generate() {
        return mockPerRoundOutput
      },
      async getEmbedding() {
        return new Array(256).fill(0)
      }
    })

    it('应从单轮对话中提取 event_log + foresight + profile', async () => {
      const extractor = new UnifiedExtractor(createMockModel())
      const memcell = buildMemCell()

      const result = await extractor.extractPerRound(memcell, '无')

      expect(result).not.toBeNull()
      expect(result!.narrative).toBeUndefined()

      expect(result!.event_log).toBeDefined()
      expect(result!.event_log!.atomic_fact).toHaveLength(2)

      expect(result!.foresight).toHaveLength(2)
      expect(result!.foresight![0].evidence).toBe('用户说「周三前把设计稿给我」')

      expect(result!.profile).toBeDefined()
      const items = (result!.profile!.user_profiles![0] as Record<string, unknown>)
        .items as string[]
      expect(items).toHaveLength(3)
      expect(items).toContain('用户名叫张三')
    })

    it('text-only MemCell 也能正常工作', async () => {
      const extractor = new UnifiedExtractor(createMockModel())
      const memcell = buildMemCell({
        original_data: undefined,
        text: 'User: 明天开会。\nAssistant: 好的，下午两点。'
      })

      const result = await extractor.extractPerRound(memcell)
      expect(result).not.toBeNull()
    })

    it('空 original_data 返回 null', async () => {
      const extractor = new UnifiedExtractor(createMockModel())
      const memcell = buildMemCell({ original_data: [], text: undefined })

      const result = await extractor.extractPerRound(memcell)
      expect(result).toBeNull()
    })
  })

  describe('extractNarrativeBatch (Pipeline 2)', () => {
    const createMockModel = (): ICompletionProvider => ({
      async generate() {
        return mockNarrativeBatchOutput
      },
      async getEmbedding() {
        return new Array(256).fill(0)
      }
    })

    it('应从多轮累积对话中提取多个 narrative + foresight + profile', async () => {
      const extractor = new UnifiedExtractor(createMockModel())
      const memcell = buildMemCell()

      const result = await extractor.extractNarrativeBatch(memcell, '无', '已有的 event_log 记忆')

      expect(result).not.toBeNull()
      expect(result!.narratives).toHaveLength(2)
      expect(result!.narratives![0].content).toContain('项目进度')
      expect(result!.narratives![1].content).toContain('技术栈选型')

      expect(result!.foresight).toHaveLength(1)
      expect(result!.foresight![0].content).toContain('前端模块')

      expect(result!.profile).toBeDefined()
      const items = (result!.profile!.user_profiles![0] as Record<string, unknown>)
        .items as string[]
      expect(items).toContain('用户注重协作')
    })
  })

  describe('extractDocument', () => {
    const createMockModel = (): ICompletionProvider => ({
      async generate() {
        return mockDocumentOutput
      },
      async getEmbedding() {
        return new Array(256).fill(0)
      }
    })

    it('应从文档中提取 overview + facts', async () => {
      const extractor = new UnifiedExtractor(createMockModel())
      const memcell = buildMemCell({
        original_data: { documentId: 'doc1', title: '架构设计文档' },
        type: RawDataType.TEXT,
        text: '文档正文内容...',
        scene: 'document',
        metadata: { documentId: 'doc1', title: '架构设计文档' }
      })

      const result = await extractor.extractDocument(memcell)

      expect(result).not.toBeNull()
      expect(result!.narrative).toBeDefined()
      expect(result!.narrative!.content).toContain('项目架构设计')

      expect(result!.document_facts).toBeDefined()
      expect(result!.document_facts!.facts).toHaveLength(2)
    })
  })
})
