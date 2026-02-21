/**
 * preambleBuilder.test.ts — BG Session preamble 构建测试
 *
 * 覆盖：
 * - inputParams 注入后生成 <input_params> XML 区块
 * - inputParams 表格格式正确
 * - 无 inputParams 时不包含 <input_params> 区块
 * - 未提供值的参数显示 "(未提供)"
 * - workflow 来源的 BG Session 不重复注入工作区说明
 * - 非 workflow 的 BG Session 保持单工作区说明
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

  it('optional 为 true 时说明列应含（可选）', () => {
    const payload: BgTriggerPayload = {
      prompt: '测试',
      inputParams: {
        schema: {
          topic: { type: 'string', description: '主题', optional: true },
          query: { type: 'string', description: '必填查询' }
        },
        values: { query: 'q' }
      }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('可选')
    expect(result).toContain('主题（可选）')
    expect(result).toContain('必填查询')
  })
})

describe('buildBgSystemPreamble — 工作区说明', () => {
  it('非 workflow BG Session 有 workspaceDir 时注入单工作区说明', () => {
    const payload: BgTriggerPayload = { prompt: '测试' }
    const meta: BgSessionMeta = {
      triggerType: 'event_hook',
      label: 'task-step',
      workspaceDir: '/some/workspace'
    }

    const result = buildBgSystemPreamble(payload, meta)

    expect(result).toContain('## 工作区')
    expect(result).toContain('/some/workspace')
    expect(result).toContain('prizm_file')
  })

  it('workflow 来源的 BG Session 不注入工作区说明段落', () => {
    const payload: BgTriggerPayload = { prompt: '测试' }
    const meta: BgSessionMeta = {
      triggerType: 'event_hook',
      label: 'workflow:step-1',
      workspaceDir: '/some/run-workspace',
      persistentWorkspaceDir: '/some/persistent-workspace',
      source: 'workflow',
      sourceId: 'run-1'
    }

    const result = buildBgSystemPreamble(payload, meta)

    expect(result).not.toContain('## 工作区')
    expect(result).not.toContain('文件操作默认在以下工作区中进行')
  })

  it('workflow BG Session 仍然注入结果提交说明', () => {
    const payload: BgTriggerPayload = { prompt: '测试' }
    const meta: BgSessionMeta = {
      triggerType: 'event_hook',
      label: 'workflow:step-1',
      workspaceDir: '/some/run-workspace',
      source: 'workflow'
    }

    const result = buildBgSystemPreamble(payload, meta)

    expect(result).toContain('prizm_set_result')
    expect(result).toContain('自动传递给下一步骤')
  })

  it('无 workspaceDir 时不注入工作区说明', () => {
    const payload: BgTriggerPayload = { prompt: '测试' }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).not.toContain('## 工作区')
    expect(result).not.toContain('文件操作默认')
  })
})

describe('buildBgSystemPreamble — context.previousStepStructured', () => {
  it('context 含 previousStepStructured 时注入前序步骤 structured_data 表格', () => {
    const payload: BgTriggerPayload = {
      prompt: '第二步',
      context: {
        previousStepStructured: { summary: '上一步摘要', count: 2 }
      }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('## 前序步骤 structured_data')
    expect(result).toContain('| 字段 | 值 |')
    expect(result).toContain('| summary |')
    expect(result).toContain('上一步摘要')
    expect(result).toContain('| count |')
    expect(result).toContain('2')
  })

  it('context 仅有其他 key 时仍用通用上下文数据区块', () => {
    const payload: BgTriggerPayload = {
      prompt: '测试',
      context: { otherKey: 'value' }
    }

    const result = buildBgSystemPreamble(payload, baseMeta)

    expect(result).toContain('## 上下文数据')
    expect(result).toContain('"otherKey"')
    expect(result).not.toContain('前序步骤 structured_data')
  })
})
