/**
 * linkedActionExecutor.test.ts — 联动操作变量解析 + 各 action 执行
 *
 * 覆盖：
 * - 变量解析（$stepId.output / $stepId.approved / $stepId.sessionId / $args.key）
 * - 多变量混合解析
 * - 不存在的引用（空值替换）
 * - create_todo 联动
 * - update_todo 联动（含找不到 list/item 的边界）
 * - create_document 联动
 * - update_schedule 联动
 * - notify 联动
 * - unknown action 类型（不崩溃）
 * - action 执行异常（不影响后续 action）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WorkflowStepResult } from '@prizm/shared'

vi.mock('../eventBus/eventBus', () => ({
  emit: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../id', () => ({
  genUniqueId: vi.fn(() => `mock-${Math.random().toString(36).slice(2, 10)}`)
}))

const mockWriteTodo = vi.fn()
const mockReadTodoById = vi.fn()
const mockWriteDoc = vi.fn()
const mockReadScheduleById = vi.fn()
const mockWriteSchedule = vi.fn()

vi.mock('../mdStore', () => ({
  writeSingleTodoList: (...args: unknown[]) => mockWriteTodo(...args),
  readSingleTodoListById: (...args: unknown[]) => mockReadTodoById(...args),
  writeSingleDocument: (...args: unknown[]) => mockWriteDoc(...args),
  readSingleScheduleById: (...args: unknown[]) => mockReadScheduleById(...args),
  writeSingleSchedule: (...args: unknown[]) => mockWriteSchedule(...args)
}))

vi.mock('../ScopeStore', () => ({
  scopeStore: {
    getScopeRootPath: (scope: string) => `/tmp/scopes/${scope}`
  }
}))

import { executeLinkedActions } from './linkedActionExecutor'
import { emit } from '../eventBus/eventBus'
const mockEmit = emit as ReturnType<typeof vi.fn>

const SAMPLE_RESULTS: Record<string, WorkflowStepResult> = {
  collect: {
    stepId: 'collect',
    status: 'completed',
    output: '采集到的数据',
    sessionId: 'sess-123'
  },
  review: {
    stepId: 'review',
    status: 'completed',
    approved: true
  }
}

describe('变量解析', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteTodo.mockReturnValue('/path')
    mockWriteDoc.mockReturnValue('/path')
  })

  it('应解析 $stepId.output', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: 'Report', content: '$collect.output' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteDoc).toHaveBeenCalledTimes(1)
    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.content).toBe('采集到的数据')
  })

  it('应解析 $stepId.sessionId', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: 'T', content: 'session=$collect.sessionId' } }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.content).toBe('session=sess-123')
  })

  it('应解析 $stepId.approved', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: 'T', content: 'approved=$review.approved' } }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.content).toBe('approved=true')
  })

  it('应解析 $args.key', async () => {
    await executeLinkedActions(
      'default',
      [{ type: 'create_document', params: { title: '$args.docTitle', content: 'ok' } }],
      SAMPLE_RESULTS,
      { docTitle: '我的文档' }
    )

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.title).toBe('我的文档')
  })

  it('应解析 $args.foo.bar dot-path（与 runner 一致）', async () => {
    await executeLinkedActions(
      'default',
      [{ type: 'create_document', params: { title: '$args.meta.title', content: '$args.meta.summary' } }],
      SAMPLE_RESULTS,
      { meta: { title: '嵌套标题', summary: '嵌套摘要' } }
    )

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.title).toBe('嵌套标题')
    expect(doc.content).toBe('嵌套摘要')
  })

  it('不存在的引用应替换为空字符串', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: 'T', content: '$nonexistent.output' } }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.content).toBe('')
  })

  it('应解析混合多个变量', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: 'Result of $collect.output (sess: $collect.sessionId)', content: '$collect.output' } }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.title).toBe('Result of 采集到的数据 (sess: sess-123)')
  })
})

describe('create_todo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteTodo.mockReturnValue('/path')
  })

  it('应创建含 name 和 title 的待办', async () => {
    await executeLinkedActions('default', [
      { type: 'create_todo', params: { name: '任务列表', title: '第一项' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteTodo).toHaveBeenCalledTimes(1)
    const list = mockWriteTodo.mock.calls[0][1]
    expect(list.name).toBe('任务列表')
    expect(list.items[0].title).toBe('第一项')
    expect(list.items[0].status).toBe('todo')
    expect(mockEmit).toHaveBeenCalledWith('todo:mutated', expect.objectContaining({
      action: 'created',
      scope: 'default'
    }))
  })

  it('无 name 时应使用默认名', async () => {
    await executeLinkedActions('default', [
      { type: 'create_todo', params: {} }
    ], SAMPLE_RESULTS)

    const list = mockWriteTodo.mock.calls[0][1]
    expect(list.name).toBe('工作流生成待办')
  })
})

describe('update_todo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应更新待办项状态', async () => {
    mockReadTodoById.mockReturnValue({
      id: 'list-1',
      name: 'test',
      items: [{ id: 'item-1', title: 'task', status: 'todo', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1
    })

    await executeLinkedActions('default', [
      { type: 'update_todo', params: { listId: 'list-1', itemId: 'item-1', status: 'done' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteTodo).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith('todo:mutated', expect.objectContaining({
      action: 'updated',
      itemId: 'item-1',
      status: 'done'
    }))
  })

  it('listId 为空时应静默跳过', async () => {
    await executeLinkedActions('default', [
      { type: 'update_todo', params: { listId: '', itemId: 'x', status: 'done' } }
    ], SAMPLE_RESULTS)

    expect(mockReadTodoById).not.toHaveBeenCalled()
  })

  it('list 不存在时应静默跳过', async () => {
    mockReadTodoById.mockReturnValue(null)

    await executeLinkedActions('default', [
      { type: 'update_todo', params: { listId: 'bad', itemId: 'x', status: 'done' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteTodo).not.toHaveBeenCalled()
  })

  it('item 不存在时应静默跳过', async () => {
    mockReadTodoById.mockReturnValue({
      id: 'list-1', name: 'test', items: [], createdAt: 1, updatedAt: 1
    })

    await executeLinkedActions('default', [
      { type: 'update_todo', params: { listId: 'list-1', itemId: 'nonexistent', status: 'done' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteTodo).not.toHaveBeenCalled()
  })
})

describe('create_document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteDoc.mockReturnValue('/path')
  })

  it('应创建含标题和内容的文档', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: { title: '报告', content: '内容', tags: 'tag1,tag2' } }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.title).toBe('报告')
    expect(doc.content).toBe('内容')
    expect(doc.tags).toEqual(['tag1', 'tag2'])
    expect(mockEmit).toHaveBeenCalledWith('document:saved', expect.objectContaining({
      scope: 'default',
      title: '报告'
    }))
  })

  it('无参数时应使用默认值', async () => {
    await executeLinkedActions('default', [
      { type: 'create_document', params: {} }
    ], SAMPLE_RESULTS)

    const doc = mockWriteDoc.mock.calls[0][1]
    expect(doc.title).toBe('工作流生成文档')
    expect(doc.content).toBe('')
    expect(doc.tags).toEqual([])
  })
})

describe('update_schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应更新日程状态', async () => {
    mockReadScheduleById.mockReturnValue({
      id: 'sched-1', title: 'event', status: 'active', updatedAt: 1
    })

    await executeLinkedActions('default', [
      { type: 'update_schedule', params: { scheduleId: 'sched-1', status: 'completed' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteSchedule).toHaveBeenCalledTimes(1)
    const item = mockWriteSchedule.mock.calls[0][1]
    expect(item.status).toBe('completed')
    expect(item.completedAt).toBeGreaterThan(0)
  })

  it('无效 status 应静默跳过', async () => {
    mockReadScheduleById.mockReturnValue({ id: 's', status: 'active', updatedAt: 1 })

    await executeLinkedActions('default', [
      { type: 'update_schedule', params: { scheduleId: 's', status: 'invalid_status' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteSchedule).not.toHaveBeenCalled()
  })

  it('scheduleId 为空时应静默跳过', async () => {
    await executeLinkedActions('default', [
      { type: 'update_schedule', params: { scheduleId: '', status: 'completed' } }
    ], SAMPLE_RESULTS)

    expect(mockReadScheduleById).not.toHaveBeenCalled()
  })
})

describe('notify', () => {
  it('无 title 时应静默跳过', async () => {
    vi.clearAllMocks()
    await executeLinkedActions('default', [
      { type: 'notify', params: { title: '', body: 'test' } }
    ], SAMPLE_RESULTS)
  })

  it('有 title 时应成功执行', async () => {
    await executeLinkedActions('default', [
      { type: 'notify', params: { title: '完成通知', body: '工作流已完成' } }
    ], SAMPLE_RESULTS)
  })
})

describe('错误处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unknown action 不应崩溃', async () => {
    await executeLinkedActions('default', [
      { type: 'unknown_action' as never, params: {} }
    ], SAMPLE_RESULTS)
  })

  it('单个 action 异常不应影响后续', async () => {
    mockWriteTodo.mockImplementationOnce(() => { throw new Error('boom') })
    mockWriteDoc.mockReturnValue('/path')

    await executeLinkedActions('default', [
      { type: 'create_todo', params: { name: 'will-fail' } },
      { type: 'create_document', params: { title: 'should-succeed' } }
    ], SAMPLE_RESULTS)

    expect(mockWriteDoc).toHaveBeenCalledTimes(1)
  })

  it('空 actions 数组应正常执行', async () => {
    await executeLinkedActions('default', [], SAMPLE_RESULTS)
  })
})
