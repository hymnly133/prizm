/**
 * preambleBuilder.test.ts — BG Session preamble 构建测试
 *
 * 覆盖：
 * - inputParams 注入后生成 <input_params> XML 区块
 * - inputParams 表格格式正确
 * - 无 inputParams 时不包含 <input_params> 区块
 * - 未提供值的参数显示 "(未提供)"
 */

import { describe, it, expect } from 'vitest'
import { buildBgSystemPreamble } from './preambleBuilder'
import type { BgSessionMeta } from '@prizm/shared'
import type { BgTriggerPayload } from './types'

const baseMeta: BgSessionMeta = {
  triggerType: 'event_hook'
}

describe('buildBgSystemPreamble — inputParams', () => {
  it('应在 preamble 中注入 <input_params> 区块', () => {
    const payload: BgTriggerPayload = {
      prompt: '生成报告',
      inputParams: {
        schema: {
          topic: { type: 'string', description: '主题' },
          count: { type: 'number', description: '数量' }
        },
        values: {
          topic: 'AI 趋势',
          count: 5
        }
      }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('<input_params>')
    expect(result).toContain('</input_params>')
    expect(result).toContain('## 本次任务输入参数')
    expect(result).toContain('| topic | string | 主题 | AI 趋势 |')
    expect(result).toContain('| count | number | 数量 | 5 |')
    expect(result).toContain('请基于以上输入参数完成任务。')
  })

  it('无 inputParams 时不包含 <input_params> 区块', () => {
    const payload: BgTriggerPayload = {
      prompt: '生成报告'
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).not.toContain('<input_params>')
    expect(result).not.toContain('本次任务输入参数')
  })

  it('未提供值的参数应显示 "(未提供)"', () => {
    const payload: BgTriggerPayload = {
      prompt: '测试',
      inputParams: {
        schema: {
          name: { type: 'string', description: '名称' },
          age: { type: 'number', description: '年龄' }
        },
        values: {
          name: '张三'
        }
      }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('| name | string | 名称 | 张三 |')
    expect(result).toContain('| age | number | 年龄 | (未提供) |')
  })

  it('schema 无 type 时默认为 string', () => {
    const payload: BgTriggerPayload = {
      prompt: '测试',
      inputParams: {
        schema: {
          foo: { description: '测试字段' }
        },
        values: { foo: 'bar' }
      }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('| foo | string | 测试字段 | bar |')
  })
})
