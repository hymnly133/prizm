/**
 * scopeInteractionParser - deriveScopeActivities 解析工具调用为 scope 活动记录
 */
import { describe, it, expect } from 'vitest'
import { deriveScopeActivities } from './scopeInteractionParser'

describe('deriveScopeActivities', () => {
  it('从 prizm_read_note 解析出 read 活动', () => {
    const activities = deriveScopeActivities(
      [{ id: '1', name: 'prizm_read_note', arguments: '{"noteId":"n1"}', result: 'ok' }],
      1000
    )
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      toolName: 'prizm_read_note',
      action: 'read',
      itemKind: 'note',
      itemId: 'n1',
      timestamp: 1000
    })
  })

  it('从 prizm_create_note 解析出 create 活动并提取 result 中的 id', () => {
    const activities = deriveScopeActivities(
      [
        {
          id: '1',
          name: 'prizm_create_note',
          arguments: '{}',
          result: '已创建便签 abc-123'
        }
      ],
      2000
    )
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      toolName: 'prizm_create_note',
      action: 'create',
      itemKind: 'note',
      itemId: 'abc-123',
      timestamp: 2000
    })
  })

  it('跳过 NO_SCOPE_TOOLS', () => {
    const activities = deriveScopeActivities(
      [
        { id: '1', name: 'prizm_notice', arguments: '{}', result: 'ok' },
        { id: '2', name: 'tavily_web_search', arguments: '{}', result: 'ok' },
        { id: '3', name: 'prizm_read_note', arguments: '{"noteId":"n1"}', result: 'ok' }
      ],
      1000
    )
    expect(activities).toHaveLength(1)
    expect(activities[0].toolName).toBe('prizm_read_note')
  })

  it('空 toolCalls 返回空数组', () => {
    expect(deriveScopeActivities([], 1000)).toEqual([])
  })
})
