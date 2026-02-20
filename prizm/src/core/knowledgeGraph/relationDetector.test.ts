/**
 * RelationDetector 单元测试
 *
 * 覆盖：实体词提取、文档引用提取、关联检测逻辑、hook注册
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./relationStore', () => ({
  addRelations: vi.fn().mockReturnValue(0)
}))

vi.mock('../agentHooks/hookRegistry', () => {
  const reg = vi.fn()
  return {
    hookRegistry: { register: reg }
  }
})

import { addRelations } from './relationStore'
import { hookRegistry } from '../agentHooks/hookRegistry'
import { detectRelations, registerRelationDetectorHook } from './relationDetector'

const mockAddRelations = addRelations as ReturnType<typeof vi.fn>
const mockRegister = hookRegistry.register as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockAddRelations.mockReset().mockReturnValue(0)
  mockRegister.mockReset()
})

describe('detectRelations', () => {
  // ─── 基本行为 ───

  it('should skip when single memory and no existing IDs', () => {
    detectRelations([{ id: 'mem-1', type: 'event_log', content: '用户讨论了天气' }])
    expect(mockAddRelations).not.toHaveBeenCalled()
  })

  it('should skip when empty memories', () => {
    detectRelations([])
    expect(mockAddRelations).not.toHaveBeenCalled()
  })

  // ─── 实体词关联检测 ───

  it('should detect related_to when memories share entity words', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: '用户正在使用 typescript 框架进行 react 开发项目'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: '下一步需要使用 typescript 和 react 完成组件'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalledTimes(1)
    const relations = mockAddRelations.mock.calls[0][0]
    const relatedTo = relations.filter((r: any) => r.relationType === 'related_to')
    expect(relatedTo.length).toBeGreaterThanOrEqual(1)
    expect(relatedTo[0]).toMatchObject({
      sourceId: 'mem-1',
      targetId: 'mem-2',
      relationType: 'related_to'
    })
  })

  it('should not detect relation when words do not overlap enough', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: '天气预报显示今天会下雨'
      },
      {
        id: 'mem-2',
        type: 'profile',
        content: '用户喜欢使用 TypeScript 进行编程'
      }
    ])

    const calls = mockAddRelations.mock.calls
    if (calls.length > 0) {
      const relatedTo = calls[0][0].filter((r: any) => r.relationType === 'related_to')
      expect(relatedTo).toHaveLength(0)
    }
  })

  it('should compute confidence based on overlap count', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: 'typescript react component hooks state management application'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: 'typescript react component hooks state management testing'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const relatedTo = relations.find((r: any) => r.relationType === 'related_to')
    expect(relatedTo).toBeDefined()
    expect(relatedTo.confidence).toBeGreaterThan(0)
    expect(relatedTo.confidence).toBeLessThanOrEqual(1.0)
  })

  // ─── 文档引用检测 ───

  it('should detect document references with doc_ prefix', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: '用户编辑了 doc_abcdefgh12 中的内容'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: '稍后需要查看 doc_abcdefgh12 的更新'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const refs = relations.filter((r: any) => r.relationType === 'references')
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs[0]).toMatchObject({
      relationType: 'references',
      confidence: 0.9
    })
  })

  it('should detect document references with document_id= format', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: 'saved to document_id=docXYZ12345678'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: 'fallback'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const refs = relations.filter((r: any) => r.relationType === 'references')
    expect(refs.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect document references with 文档: format', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: '文档：MyDocumentID12345 已更新'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: 'other content'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const refs = relations.filter((r: any) => r.relationType === 'references')
    expect(refs.length).toBeGreaterThanOrEqual(1)
  })

  it('should deduplicate document refs within single memory', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: 'doc_abcd1234abcd appeared twice: doc_abcd1234abcd'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: 'filler content here'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const refsFromMem1 = relations.filter(
      (r: any) => r.sourceId === 'mem-1' && r.relationType === 'references'
    )
    const targetIds = refsFromMem1.map((r: any) => r.targetId)
    expect(new Set(targetIds).size).toBe(targetIds.length)
  })

  // ─── 混合场景 ───

  it('should detect both entity overlap and doc refs', () => {
    detectRelations([
      {
        id: 'mem-1',
        type: 'event_log',
        content: 'updated doc_testdocument1 with typescript react code'
      },
      {
        id: 'mem-2',
        type: 'foresight',
        content: 'will review typescript react code in doc_testdocument1'
      }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    const refs = relations.filter((r: any) => r.relationType === 'references')
    const relatedTo = relations.filter((r: any) => r.relationType === 'related_to')

    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(relatedTo.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle three or more memories', () => {
    detectRelations([
      { id: 'm1', type: 'event_log', content: 'typescript react component' },
      { id: 'm2', type: 'foresight', content: 'typescript react testing hooks' },
      { id: 'm3', type: 'profile', content: 'react component development patterns' }
    ])

    expect(mockAddRelations).toHaveBeenCalled()
    const relations = mockAddRelations.mock.calls[0][0]
    expect(relations.length).toBeGreaterThanOrEqual(1)
  })

  // ─── 错误处理 ───

  it('should handle addRelations error gracefully', () => {
    mockAddRelations.mockImplementation(() => {
      throw new Error('DB error')
    })

    expect(() =>
      detectRelations([
        { id: 'mem-1', type: 'event_log', content: 'typescript react something long' },
        { id: 'mem-2', type: 'foresight', content: 'typescript react something long too' }
      ])
    ).not.toThrow()
  })
})

// ─── Hook 注册 ───

describe('registerRelationDetectorHook', () => {
  it('should register a PostMemoryExtract hook', () => {
    registerRelationDetectorHook()
    expect(mockRegister).toHaveBeenCalledTimes(1)

    const registration = mockRegister.mock.calls[0][0]
    expect(registration.id).toBe('builtin:relation-detector')
    expect(registration.event).toBe('PostMemoryExtract')
    expect(registration.priority).toBe(200)
    expect(typeof registration.callback).toBe('function')
  })

  it('should call detectRelations on created memories', async () => {
    registerRelationDetectorHook()
    const registration = mockRegister.mock.calls[0][0]

    await registration.callback({
      scope: 'default',
      sessionId: 'sess-1',
      pipeline: 'P1',
      created: [
        { id: 'n1', type: 'event_log', content: 'typescript react hooks component' },
        { id: 'n2', type: 'foresight', content: 'typescript react hooks testing' }
      ]
    })

    expect(mockAddRelations).toHaveBeenCalled()
  })

  it('should not call detectRelations when no created memories', async () => {
    registerRelationDetectorHook()
    const registration = mockRegister.mock.calls[0][0]

    await registration.callback({
      scope: 'default',
      sessionId: 'sess-1',
      pipeline: 'P1',
      created: []
    })

    expect(mockAddRelations).not.toHaveBeenCalled()
  })
})
