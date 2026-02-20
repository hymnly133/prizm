/**
 * parser.test.ts — 工作流 YAML/JSON 解析 + 校验
 *
 * 覆盖：
 * - YAML / JSON 正常解析
 * - name / steps 字段校验
 * - step id 唯一性
 * - step type 校验（agent / approve / transform）
 * - 各 step type 必填字段
 * - $stepId.output 引用合法性（前序步骤）
 * - $prev 引用
 * - trigger 校验
 * - 可选字段 (description, args, model, timeoutMs, linkedActions)
 * - 序列化 round-trip
 * - 畸形/空输入
 * - 特殊字符 step id
 */

import { describe, it, expect } from 'vitest'
import { parseWorkflowDef, serializeWorkflowDef, WorkflowParseError } from './parser'

// ─── 辅助 ───

const MINIMAL_YAML = `
name: test-wf
steps:
  - id: step1
    type: agent
    prompt: "hello"
`

const MINIMAL_JSON = JSON.stringify({
  name: 'test-wf',
  steps: [{ id: 'step1', type: 'agent', prompt: 'hello' }]
})

// ─── 正常解析 ───

describe('parseWorkflowDef — 正常解析', () => {
  it('应该解析最小 YAML 定义', () => {
    const def = parseWorkflowDef(MINIMAL_YAML)
    expect(def.name).toBe('test-wf')
    expect(def.steps).toHaveLength(1)
    expect(def.steps[0].id).toBe('step1')
    expect(def.steps[0].type).toBe('agent')
    expect(def.steps[0].prompt).toBe('hello')
  })

  it('应该解析 JSON 定义', () => {
    const def = parseWorkflowDef(MINIMAL_JSON)
    expect(def.name).toBe('test-wf')
    expect(def.steps).toHaveLength(1)
  })

  it('应该解析带空格前缀的 JSON', () => {
    const def = parseWorkflowDef(`  ${MINIMAL_JSON}  `)
    expect(def.name).toBe('test-wf')
  })

  it('应该解析多步骤工作流', () => {
    const yaml = `
name: multi
steps:
  - id: collect
    type: agent
    prompt: "收集数据"
  - id: review
    type: approve
    approvePrompt: "审核数据"
  - id: transform
    type: transform
    input: "$collect.output"
    transform: "summary"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps).toHaveLength(3)
    expect(def.steps[0].type).toBe('agent')
    expect(def.steps[1].type).toBe('approve')
    expect(def.steps[2].type).toBe('transform')
    expect(def.steps[2].input).toBe('$collect.output')
  })

  it('应该解析带 description 和 args 的定义', () => {
    const yaml = `
name: with-meta
description: "测试描述"
args:
  topic:
    default: "AI"
    description: "主题"
steps:
  - id: s1
    type: agent
    prompt: "关于 $args.topic"
`
    const def = parseWorkflowDef(yaml)
    expect(def.description).toBe('测试描述')
    expect(def.args?.topic?.default).toBe('AI')
    expect(def.args?.topic?.description).toBe('主题')
  })

  it('应该解析带 triggers 的定义', () => {
    const yaml = `
name: triggered
steps:
  - id: s1
    type: agent
    prompt: "go"
triggers:
  - type: cron
    filter:
      jobName: daily
  - type: todo_completed
`
    const def = parseWorkflowDef(yaml)
    expect(def.triggers).toHaveLength(2)
    expect(def.triggers![0].type).toBe('cron')
    expect(def.triggers![0].filter).toEqual({ jobName: 'daily' })
    expect(def.triggers![1].type).toBe('todo_completed')
  })

  it('应该解析 approve step 的 prompt (作为 approvePrompt 的替代)', () => {
    const yaml = `
name: approve-alt
steps:
  - id: s1
    type: approve
    prompt: "确认执行?"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[0].prompt).toBe('确认执行?')
  })

  it('应该解析 step 的 model 和 timeoutMs', () => {
    const yaml = `
name: with-options
steps:
  - id: s1
    type: agent
    prompt: "go"
    model: gpt-4o
    timeoutMs: 30000
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[0].model).toBe('gpt-4o')
    expect(def.steps[0].timeoutMs).toBe(30000)
  })

  it('应该解析 step 的 linkedActions', () => {
    const yaml = `
name: linked
steps:
  - id: s1
    type: agent
    prompt: "generate"
    linkedActions:
      - type: create_document
        params:
          title: "Report"
          content: "$s1.output"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[0].linkedActions).toHaveLength(1)
    expect(def.steps[0].linkedActions![0].type).toBe('create_document')
    expect(def.steps[0].linkedActions![0].params.content).toBe('$s1.output')
  })

  it('应该允许 $prev 引用', () => {
    const yaml = `
name: prev-ref
steps:
  - id: s1
    type: agent
    prompt: "step 1"
  - id: s2
    type: agent
    prompt: "step 2"
    input: "$prev.output"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[1].input).toBe('$prev.output')
  })

  it('应该允许带 condition 的步骤', () => {
    const yaml = `
name: conditional
steps:
  - id: check
    type: approve
    approvePrompt: "continue?"
  - id: run_if_approved
    type: agent
    prompt: "do it"
    condition: "$check.approved"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[1].condition).toBe('$check.approved')
  })
})

// ─── 校验错误 ───

describe('parseWorkflowDef — 校验错误', () => {
  it('应该拒绝无效 YAML', () => {
    expect(() => parseWorkflowDef('{{{')).toThrow(WorkflowParseError)
  })

  it('应该拒绝空字符串', () => {
    expect(() => parseWorkflowDef('')).toThrow(WorkflowParseError)
  })

  it('应该拒绝纯数字', () => {
    expect(() => parseWorkflowDef('42')).toThrow('工作流定义必须是一个对象')
  })

  it('应该拒绝纯字符串', () => {
    expect(() => parseWorkflowDef('"hello"')).toThrow('工作流定义必须是一个对象')
  })

  it('应该拒绝 null', () => {
    expect(() => parseWorkflowDef('null')).toThrow('工作流定义必须是一个对象')
  })

  it('应该拒绝缺少 name 的定义', () => {
    expect(() => parseWorkflowDef('{ "steps": [{"id":"s","type":"agent","prompt":"x"}] }')).toThrow(
      '缺少 name 字段'
    )
  })

  it('应该拒绝 name 非字符串', () => {
    expect(() =>
      parseWorkflowDef('{ "name": 123, "steps": [{"id":"s","type":"agent","prompt":"x"}] }')
    ).toThrow('缺少 name 字段')
  })

  it('应该拒绝缺少 steps 的定义', () => {
    expect(() => parseWorkflowDef('{ "name": "test" }')).toThrow('缺少 steps 数组')
  })

  it('应该拒绝空 steps 数组', () => {
    expect(() => parseWorkflowDef('{ "name": "test", "steps": [] }')).toThrow('steps 为空')
  })

  it('应该拒绝 steps 非数组', () => {
    expect(() => parseWorkflowDef('{ "name": "test", "steps": "not array" }')).toThrow(
      '缺少 steps 数组'
    )
  })
})

// ─── Step 级校验 ───

describe('parseWorkflowDef — Step 校验', () => {
  it('应该为缺少 id 的步骤自动生成 id', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ type: 'agent', prompt: 'x' }] })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].id).toBe('step_1')
  })

  it('应该为多个无 id 步骤生成不同的 id', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { type: 'agent', prompt: 'a' },
        { type: 'agent', prompt: 'b' },
        { type: 'approve', approvePrompt: 'c' }
      ]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].id).toBe('step_1')
    expect(def.steps[1].id).toBe('step_2')
    expect(def.steps[2].id).toBe('step_3')
    const ids = new Set(def.steps.map((s) => s.id))
    expect(ids.size).toBe(3)
  })

  it('应该允许混合有 id 和无 id 的步骤', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { id: 'custom', type: 'agent', prompt: 'a' },
        { type: 'agent', prompt: 'b' }
      ]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].id).toBe('custom')
    expect(def.steps[1].id).toBe('step_2')
  })

  it('应该拒绝重复 id', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { id: 'dup', type: 'agent', prompt: 'a' },
        { id: 'dup', type: 'agent', prompt: 'b' }
      ]
    })
    expect(() => parseWorkflowDef(json)).toThrow('重复')
  })

  it('应该拒绝无效 step type', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ id: 's', type: 'invalid', prompt: 'x' }] })
    expect(() => parseWorkflowDef(json)).toThrow('无效')
    expect(() => parseWorkflowDef(json)).toThrow('仅支持')
  })

  it('应该拒绝缺少 type 的步骤', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ id: 's', prompt: 'x' }] })
    expect(() => parseWorkflowDef(json)).toThrow('无效')
    expect(() => parseWorkflowDef(json)).toThrow('仅支持')
  })

  it('应该拒绝 agent step 缺少 prompt', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ id: 's', type: 'agent' }] })
    expect(() => parseWorkflowDef(json)).toThrow('缺少 prompt')
  })

  it('应该拒绝 approve step 缺少 approvePrompt 和 prompt', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ id: 's', type: 'approve' }] })
    expect(() => parseWorkflowDef(json)).toThrow('缺少 approvePrompt 或 prompt')
  })

  it('应该拒绝 transform step 缺少 transform', () => {
    const json = JSON.stringify({ name: 'x', steps: [{ id: 's', type: 'transform' }] })
    expect(() => parseWorkflowDef(json)).toThrow('缺少 transform')
  })
})

// ─── 引用校验 ───

describe('parseWorkflowDef — 引用校验', () => {
  it('应该拒绝引用不存在的步骤', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { id: 'a', type: 'agent', prompt: 'x' },
        { id: 'b', type: 'agent', prompt: 'x', input: '$nonexistent.output' }
      ]
    })
    expect(() => parseWorkflowDef(json)).toThrow('引用了不存在的步骤')
  })

  it('应该拒绝 condition 引用不存在的步骤', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 'a', type: 'agent', prompt: 'x', condition: '$missing.approved' }]
    })
    expect(() => parseWorkflowDef(json)).toThrow('引用了不存在的步骤')
  })

  it('应该允许引用已声明的前序步骤', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { id: 'a', type: 'agent', prompt: 'x' },
        { id: 'b', type: 'agent', prompt: 'x', input: '$a.output' }
      ]
    })
    expect(() => parseWorkflowDef(json)).not.toThrow()
  })

  it('不应该校验后序步骤（引用后面的步骤应该报错）', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [
        { id: 'a', type: 'agent', prompt: 'x', input: '$b.output' },
        { id: 'b', type: 'agent', prompt: 'x' }
      ]
    })
    expect(() => parseWorkflowDef(json)).toThrow('引用了不存在的步骤')
  })

  it('应该允许 $prev 引用即使是第一个步骤', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 'a', type: 'agent', prompt: 'x', input: '$prev.output' }]
    })
    expect(() => parseWorkflowDef(json)).not.toThrow()
  })
})

// ─── Trigger 校验 ───

describe('parseWorkflowDef — Trigger 校验', () => {
  it('应该拒绝无效 trigger type', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 's', type: 'agent', prompt: 'x' }],
      triggers: [{ type: 'invalid_trigger' }]
    })
    expect(() => parseWorkflowDef(json)).toThrow('trigger type 无效')
  })

  it('应该拒绝非对象的 trigger', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 's', type: 'agent', prompt: 'x' }],
      triggers: ['not an object']
    })
    expect(() => parseWorkflowDef(json)).toThrow('trigger 定义必须是对象')
  })

  it('应该接受所有合法 trigger 类型', () => {
    for (const type of ['cron', 'schedule_remind', 'todo_completed', 'document_saved']) {
      const json = JSON.stringify({
        name: 'x',
        steps: [{ id: 's', type: 'agent', prompt: 'x' }],
        triggers: [{ type }]
      })
      const def = parseWorkflowDef(json)
      expect(def.triggers![0].type).toBe(type)
    }
  })
})

// ─── 序列化 round-trip ───

describe('serializeWorkflowDef', () => {
  it('应该能 round-trip YAML 定义', () => {
    const original = parseWorkflowDef(MINIMAL_YAML)
    const yaml = serializeWorkflowDef(original)
    const restored = parseWorkflowDef(yaml)
    expect(restored.name).toBe(original.name)
    expect(restored.steps).toHaveLength(original.steps.length)
    expect(restored.steps[0].id).toBe(original.steps[0].id)
  })

  it('应该保留 triggers 和 args', () => {
    const def = parseWorkflowDef(`
name: full
description: "full test"
args:
  key:
    default: "val"
steps:
  - id: s1
    type: agent
    prompt: "go"
triggers:
  - type: cron
    filter:
      name: "daily"
`)
    const yaml = serializeWorkflowDef(def)
    const restored = parseWorkflowDef(yaml)
    expect(restored.description).toBe('full test')
    expect(restored.triggers).toHaveLength(1)
    expect(restored.args?.key?.default).toBe('val')
  })
})

// ─── 边缘情况 ───

describe('parseWorkflowDef — 边缘情况', () => {
  it('应该处理超长 prompt', () => {
    const longPrompt = 'x'.repeat(100_000)
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 's', type: 'agent', prompt: longPrompt }]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].prompt).toHaveLength(100_000)
  })

  it('应该处理特殊字符 step id (下划线、数字)', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{ id: 'step_123_abc', type: 'agent', prompt: 'x' }]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].id).toBe('step_123_abc')
  })

  it('应该处理多行 YAML prompt', () => {
    const yaml = `
name: multiline
steps:
  - id: s1
    type: agent
    prompt: |
      第一行
      第二行
      第三行
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[0].prompt).toContain('第一行')
    expect(def.steps[0].prompt).toContain('第三行')
  })

  it('应该处理 YAML 中的中文 name', () => {
    const yaml = `
name: 数据采集流程
steps:
  - id: s1
    type: agent
    prompt: "开始采集"
`
    const def = parseWorkflowDef(yaml)
    expect(def.name).toBe('数据采集流程')
  })

  it('应该处理单步 transform 工作流', () => {
    const json = JSON.stringify({
      name: 'single-transform',
      steps: [{ id: 's', type: 'transform', transform: 'data' }]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].type).toBe('transform')
  })

  it('应该正确处理 JSON 中转义字符', () => {
    const json = JSON.stringify({
      name: 'escaped',
      steps: [{ id: 's', type: 'agent', prompt: 'line1\nline2\ttab' }]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].prompt).toContain('\n')
  })
})

// ─── Outputs 字段解析 ───

describe('parseWorkflowDef — outputs 字段', () => {
  it('应该正确解析 outputs 定义', () => {
    const yaml = `
name: io-wf
steps:
  - id: s1
    type: agent
    prompt: "生成摘要"
outputs:
  summary:
    type: string
    description: 摘要
  tags:
    type: string
    description: 标签
`
    const def = parseWorkflowDef(yaml)
    expect(def.outputs).toBeDefined()
    expect(def.outputs!.summary).toEqual({ type: 'string', description: '摘要' })
    expect(def.outputs!.tags).toEqual({ type: 'string', description: '标签' })
  })

  it('无 outputs 时 def.outputs 为 undefined', () => {
    const def = parseWorkflowDef(MINIMAL_YAML)
    expect(def.outputs).toBeUndefined()
  })

  it('outputs 字段在序列化 round-trip 中保留', () => {
    const yaml = `
name: roundtrip-outputs
steps:
  - id: s1
    type: agent
    prompt: test
outputs:
  result:
    type: object
    description: 最终结果
`
    const def1 = parseWorkflowDef(yaml)
    const serialized = serializeWorkflowDef(def1)
    const def2 = parseWorkflowDef(serialized)
    expect(def2.outputs).toEqual(def1.outputs)
  })

  it('outputs 中非对象值应抛出错误', () => {
    const yaml = `
name: bad-outputs
steps:
  - id: s1
    type: agent
    prompt: test
outputs:
  bad_field: "not_an_object"
`
    expect(() => parseWorkflowDef(yaml)).toThrow()
  })

  it('outputs 中无 type 的字段应保留', () => {
    const yaml = `
name: no-type-output
steps:
  - id: s1
    type: agent
    prompt: test
outputs:
  text:
    description: 纯文本
`
    const def = parseWorkflowDef(yaml)
    expect(def.outputs!.text).toEqual({ description: '纯文本' })
  })
})

// ─── config 字段解析 ───

describe('parseWorkflowDef — config 字段', () => {
  it('应该解析完整 config', () => {
    const yaml = `
name: configured
steps:
  - id: s1
    type: agent
    prompt: go
config:
  errorStrategy: continue
  workspaceMode: isolated
  maxTotalTimeoutMs: 600000
  notifyOnComplete: true
  notifyOnFail: true
  tags:
    - daily
    - report
  version: "1.0"
`
    const def = parseWorkflowDef(yaml)
    expect(def.config).toBeDefined()
    expect(def.config!.errorStrategy).toBe('continue')
    expect(def.config!.workspaceMode).toBe('isolated')
    expect(def.config!.maxTotalTimeoutMs).toBe(600000)
    expect(def.config!.notifyOnComplete).toBe(true)
    expect(def.config!.notifyOnFail).toBe(true)
    expect(def.config!.tags).toEqual(['daily', 'report'])
    expect(def.config!.version).toBe('1.0')
  })

  it('无 config 时 def.config 为 undefined', () => {
    const def = parseWorkflowDef(MINIMAL_YAML)
    expect(def.config).toBeUndefined()
  })

  it('应该忽略 config 中无效的 errorStrategy', () => {
    const yaml = `
name: bad-strategy
steps:
  - id: s1
    type: agent
    prompt: go
config:
  errorStrategy: invalid
`
    const def = parseWorkflowDef(yaml)
    expect(def.config).toBeDefined()
    expect(def.config!.errorStrategy).toBeUndefined()
  })

  it('应该忽略 config 中无效的 workspaceMode', () => {
    const yaml = `
name: bad-ws
steps:
  - id: s1
    type: agent
    prompt: go
config:
  workspaceMode: custom
`
    const def = parseWorkflowDef(yaml)
    expect(def.config!.workspaceMode).toBeUndefined()
  })

  it('config 在序列化 round-trip 中保留', () => {
    const yaml = `
name: roundtrip-config
steps:
  - id: s1
    type: agent
    prompt: go
config:
  errorStrategy: fail_fast
  workspaceMode: dual
  notifyOnComplete: false
`
    const def1 = parseWorkflowDef(yaml)
    const serialized = serializeWorkflowDef(def1)
    const def2 = parseWorkflowDef(serialized)
    expect(def2.config).toEqual(def1.config)
  })
})

// ─── step description / sessionConfig / retryConfig ───

describe('parseWorkflowDef — step 高级字段', () => {
  it('应该解析 step description', () => {
    const yaml = `
name: desc-wf
steps:
  - id: s1
    type: agent
    prompt: go
    description: "收集用户数据"
`
    const def = parseWorkflowDef(yaml)
    expect(def.steps[0].description).toBe('收集用户数据')
  })

  it('应该解析 step sessionConfig', () => {
    const yaml = `
name: sc-wf
steps:
  - id: s1
    type: agent
    prompt: go
    sessionConfig:
      thinking: true
      skills:
        - code-review
        - testing
      model: gpt-4o
      maxTurns: 10
      allowedTools:
        - prizm_file
        - prizm_document
      expectedOutputFormat: JSON
      maxSchemaRetries: 3
      toolGroups:
        terminal: false
`
    const def = parseWorkflowDef(yaml)
    const sc = def.steps[0].sessionConfig!
    expect(sc.thinking).toBe(true)
    expect(sc.skills).toEqual(['code-review', 'testing'])
    expect(sc.model).toBe('gpt-4o')
    expect(sc.maxTurns).toBe(10)
    expect(sc.allowedTools).toEqual(['prizm_file', 'prizm_document'])
    expect(sc.expectedOutputFormat).toBe('JSON')
    expect(sc.maxSchemaRetries).toBe(3)
    expect(sc.toolGroups).toEqual({ terminal: false })
  })

  it('应该解析 step retryConfig', () => {
    const yaml = `
name: retry-wf
steps:
  - id: s1
    type: agent
    prompt: go
    retryConfig:
      maxRetries: 3
      retryDelayMs: 5000
      retryOn:
        - failed
        - timeout
`
    const def = parseWorkflowDef(yaml)
    const rc = def.steps[0].retryConfig!
    expect(rc.maxRetries).toBe(3)
    expect(rc.retryDelayMs).toBe(5000)
    expect(rc.retryOn).toEqual(['failed', 'timeout'])
  })

  it('retryConfig.retryOn 应过滤无效值', () => {
    const json = JSON.stringify({
      name: 'x',
      steps: [{
        id: 's1',
        type: 'agent',
        prompt: 'go',
        retryConfig: { maxRetries: 1, retryOn: ['failed', 'invalid', 'timeout'] }
      }]
    })
    const def = parseWorkflowDef(json)
    expect(def.steps[0].retryConfig!.retryOn).toEqual(['failed', 'timeout'])
  })

  it('无 sessionConfig/retryConfig 时字段为 undefined', () => {
    const def = parseWorkflowDef(MINIMAL_YAML)
    expect(def.steps[0].sessionConfig).toBeUndefined()
    expect(def.steps[0].retryConfig).toBeUndefined()
    expect(def.steps[0].description).toBeUndefined()
  })

  it('sessionConfig 中 outputSchema 应保留', () => {
    const json = JSON.stringify({
      name: 'schema-wf',
      steps: [{
        id: 's1',
        type: 'agent',
        prompt: 'go',
        sessionConfig: {
          outputSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string' }
            },
            required: ['summary']
          }
        }
      }]
    })
    const def = parseWorkflowDef(json)
    const schema = def.steps[0].sessionConfig!.outputSchema!
    expect(schema.type).toBe('object')
    expect((schema.properties as Record<string, unknown>)).toBeDefined()
  })

  it('完整工作流定义 round-trip 保留 step 高级字段', () => {
    const yaml = `
name: full-roundtrip
steps:
  - id: s1
    type: agent
    prompt: go
    description: step one
    sessionConfig:
      thinking: true
      model: gpt-4o
    retryConfig:
      maxRetries: 2
config:
  errorStrategy: continue
`
    const def1 = parseWorkflowDef(yaml)
    const serialized = serializeWorkflowDef(def1)
    const def2 = parseWorkflowDef(serialized)
    expect(def2.steps[0].description).toBe('step one')
    expect(def2.steps[0].sessionConfig!.thinking).toBe(true)
    expect(def2.steps[0].sessionConfig!.model).toBe('gpt-4o')
    expect(def2.steps[0].retryConfig!.maxRetries).toBe(2)
    expect(def2.config!.errorStrategy).toBe('continue')
  })
})
