import { describe, it, expect } from 'vitest'
import { parseUnifiedMemoryText } from './unifiedMemoryParser.js'

describe('parseUnifiedMemoryText', () => {
  /** 与提示词中 output_format 一致的期望输出样本（新格式：无 USER_ID，使用 SUMMARY） */
  const fullExpectedOutput = `
## EPISODE
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
USER_NAME: 张三
SUMMARY: 用户张三擅长 TypeScript 和 Node.js，负责前端开发与需求对接
HARD_SKILLS: TypeScript, Node.js
SOFT_SKILLS: 沟通, 协作
WORK_RESPONSIBILITY: 前端开发, 需求对接
INTERESTS: 技术分享
TENDENCY: 务实
`

  it('完整解析四类小节：EPISODE / EVENT_LOG / FORESIGHT / PROFILE', () => {
    const result = parseUnifiedMemoryText(fullExpectedOutput)
    expect(result).not.toBeNull()

    expect(result!.episode?.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result!.episode?.summary).toBe('讨论项目进度与下周计划。')
    expect(result!.episode?.keywords).toEqual(['项目', '进度', '设计稿'])

    expect(result!.event_log?.time).toBe('2025-02-15')
    expect(result!.event_log?.atomic_fact).toEqual([
      '用户提出周三前完成设计稿。',
      '约定下周一下午开会评审。'
    ])

    expect(result!.foresight).toHaveLength(2)
    expect(result!.foresight![0].content).toBe('周三前需交付设计稿')
    expect(result!.foresight![0].start_time).toBe('2025-02-15')
    expect(result!.foresight![0].end_time).toBe('2025-02-19')
    expect(result!.foresight![0].evidence).toBe('用户说「周三前把设计稿给我」')
    expect(result!.foresight![1].content).toBe('下周一下午进行评审会议')
    expect(result!.foresight![1].evidence).toBe('约定下周一下午开会评审')

    expect(result!.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.user_id).toBeUndefined()
    expect(p.user_name).toBe('张三')
    expect(p.summary).toBe('用户张三擅长 TypeScript 和 Node.js，负责前端开发与需求对接')
    expect(p.output_reasoning).toBe('用户张三擅长 TypeScript 和 Node.js，负责前端开发与需求对接')
    expect(p.hard_skills).toEqual(['TypeScript', 'Node.js'])
    expect(p.soft_skills).toEqual(['沟通', '协作'])
    expect(p.work_responsibility).toEqual(['前端开发', '需求对接'])
    expect(p.interests).toEqual(['技术分享'])
    expect(p.tendency).toEqual(['务实'])
  })

  it('值内包含英文冒号时仍按第一冒号切分键值', () => {
    const text = `
## EPISODE
CONTENT: 会议时间：明天下午 3:00，地点：A 会议室
SUMMARY: 时间：明天下午
KEYWORDS: 会议, 时间
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.episode?.content).toBe('会议时间：明天下午 3:00，地点：A 会议室')
    expect(result?.episode?.summary).toBe('时间：明天下午')
    expect(result?.episode?.keywords).toEqual(['会议', '时间'])
  })

  it('EVENT_LOG 最多解析 10 条 FACT', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `FACT: 事实${i + 1}`).join('\n')
    const text = `
## EVENT_LOG
TIME: 2025-02-15
${lines}
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.event_log?.atomic_fact).toHaveLength(10)
    expect(result?.event_log?.atomic_fact![0]).toBe('事实1')
    expect(result?.event_log?.atomic_fact![9]).toBe('事实10')
  })

  it('FORESIGHT 最多解析 10 条（--- 分隔）', () => {
    const blocks = Array.from(
      { length: 12 },
      (_, i) => `CONTENT: 前瞻${i + 1}\nSTART: 2025-02-15\nEND: 2025-02-20\nEVIDENCE: 证据${i + 1}`
    ).join('\n---\n')
    const text = `
## FORESIGHT
${blocks}
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.foresight).toHaveLength(10)
    expect(result?.foresight![0].content).toBe('前瞻1')
    expect(result?.foresight![9].content).toBe('前瞻10')
  })

  it('PROFILE 无需 USER_ID；有任意有效字段即可', () => {
    const text = `
## PROFILE
USER_NAME: 李四
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.user_id).toBeUndefined()
    expect(p.user_name).toBe('李四')
    expect(p.hard_skills).toBeUndefined()
    expect(p.soft_skills).toBeUndefined()
  })

  it('PROFILE 兼容旧格式 USER_ID + OUTPUT_REASONING', () => {
    const text = `
## PROFILE
USER_ID: u1
USER_NAME: 李四
OUTPUT_REASONING: 用户提到了自己的名字
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.user_id).toBe('u1')
    expect(p.user_name).toBe('李四')
    expect(p.output_reasoning).toBe('用户提到了自己的名字')
  })

  it('仅有 EPISODE 时仍返回有效结果', () => {
    const text = `
## EPISODE
CONTENT: 仅有一段情景摘要
SUMMARY: 一句话
KEYWORDS: a, b
`
    const result = parseUnifiedMemoryText(text)
    expect(result).not.toBeNull()
    expect(result!.episode?.content).toBe('仅有一段情景摘要')
    expect(result!.event_log).toBeUndefined()
    expect(result!.foresight).toBeUndefined()
    expect(result!.profile).toBeUndefined()
  })

  it('无 CONTENT 的 EPISODE 不写入 episode', () => {
    const text = `
## EPISODE
SUMMARY: 只有摘要没有 CONTENT
KEYWORDS: x
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.episode).toBeUndefined()
  })

  it('PROFILE 无 USER_ID 时仍可写入（不再依赖 USER_ID）', () => {
    const text = `
## PROFILE
USER_NAME: 无名
HARD_SKILLS: 无
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.user_name).toBe('无名')
    expect(p.hard_skills).toEqual(['无'])
  })

  it('无任何有效内容时返回 null', () => {
    expect(parseUnifiedMemoryText('')).toBeNull()
    expect(parseUnifiedMemoryText('   \n  \n')).toBeNull()
    expect(parseUnifiedMemoryText('## EPISODE\nSUMMARY: 无 CONTENT')).toBeNull()
  })

  it('PROFILE 仅有空字段时不写入', () => {
    expect(parseUnifiedMemoryText('## PROFILE\n')).toBeNull()
  })

  it('PROFILE 仅含 SUMMARY 时有效（如称呼偏好场景）', () => {
    const text = `
## PROFILE
SUMMARY: 用户希望被称呼为"老大"
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.summary).toBe('用户希望被称呼为"老大"')
    expect(p.output_reasoning).toBe('用户希望被称呼为"老大"')
    expect(p.user_name).toBeUndefined()
  })

  it('小节标题大小写不敏感（解析器转大写）', () => {
    const text = `
## episode
CONTENT: 小写标题
SUMMARY: 测试
KEYWORDS: k
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.episode?.content).toBe('小写标题')
  })

  it('Windows 换行 \\r\\n 正常解析', () => {
    const text =
      '## EPISODE\r\nCONTENT: 内容\r\nSUMMARY: 摘要\r\nKEYWORDS: a, b\r\n\r\n## EVENT_LOG\r\nTIME: 2025-02-15\r\nFACT: 事实1\r\n'
    const result = parseUnifiedMemoryText(text)
    expect(result?.episode?.content).toBe('内容')
    expect(result?.event_log?.atomic_fact).toEqual(['事实1'])
  })

  it('前后空白 trim 后仍能解析', () => {
    const result = parseUnifiedMemoryText('\n  \n' + fullExpectedOutput + '\n  ')
    expect(result?.episode?.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result?.profile?.user_profiles?.[0]).toBeDefined()
  })
})
