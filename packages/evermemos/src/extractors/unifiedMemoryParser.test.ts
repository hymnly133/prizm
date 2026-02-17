import { describe, it, expect } from 'vitest'
import { parseUnifiedMemoryText } from './unifiedMemoryParser.js'

describe('parseUnifiedMemoryText', () => {
  /** 与提示词中 output_format 一致的期望输出样本（PROFILE 使用 ITEM 原子画像） */
  const fullExpectedOutput = `
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
ITEM: 用户擅长 TypeScript 和 Node.js
ITEM: 用户负责前端开发与需求对接
ITEM: 用户热爱技术分享
`

  it('完整解析四类小节：NARRATIVE / EVENT_LOG / FORESIGHT / PROFILE', () => {
    const result = parseUnifiedMemoryText(fullExpectedOutput)
    expect(result).not.toBeNull()

    expect(result!.narrative?.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result!.narrative?.summary).toBe('讨论项目进度与下周计划。')
    expect(result!.narrative?.keywords).toEqual(['项目', '进度', '设计稿'])

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

    // Profile: 单条记录，items 包含所有 ITEM
    expect(result!.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    const items = p.items as string[]
    expect(items).toHaveLength(3)
    expect(items).toContain('用户擅长 TypeScript 和 Node.js')
    expect(items).toContain('用户负责前端开发与需求对接')
    expect(items).toContain('用户热爱技术分享')
    // 不应有 user_name 字段（不区分用户，称呼作为 ITEM）
    expect(p.user_name).toBeUndefined()
  })

  it('值内包含英文冒号时仍按第一冒号切分键值', () => {
    const text = `
## NARRATIVE
CONTENT: 会议时间：明天下午 3:00，地点：A 会议室
SUMMARY: 时间：明天下午
KEYWORDS: 会议, 时间
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative?.content).toBe('会议时间：明天下午 3:00，地点：A 会议室')
    expect(result?.narrative?.summary).toBe('时间：明天下午')
    expect(result?.narrative?.keywords).toEqual(['会议', '时间'])
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

  it('PROFILE 仅有 ITEM 时有效', () => {
    const text = `
## PROFILE
ITEM: 用户偏好暗色主题
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect((p.items as string[])[0]).toBe('用户偏好暗色主题')
  })

  it('PROFILE 多个 ITEM 收集到单条记录的 items 数组', () => {
    const text = `
## PROFILE
ITEM: 用户希望被称为"老大"
ITEM: 用户喜欢华语流行音乐
ITEM: 用户特别喜爱周杰伦
ITEM: 用户正在开发名为"Prizm"的项目
ITEM: 用户习惯使用便签记录项目和想法
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    const items = p.items as string[]
    expect(items).toHaveLength(5)
    expect(items[0]).toBe('用户希望被称为"老大"')
    expect(items[1]).toBe('用户喜欢华语流行音乐')
    expect(items[2]).toBe('用户特别喜爱周杰伦')
  })

  it('PROFILE 忽略 USER_NAME（已废弃，称呼作为 ITEM）', () => {
    const text = `
## PROFILE
USER_NAME: 张三
ITEM: 用户名叫张三
ITEM: 用户喜欢跑步
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.profile?.user_profiles).toHaveLength(1)
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    // USER_NAME 不再被解析为字段
    expect(p.user_name).toBeUndefined()
    expect(p.items).toEqual(['用户名叫张三', '用户喜欢跑步'])
  })

  it('仅有 NARRATIVE 时仍返回有效结果', () => {
    const text = `
## NARRATIVE
CONTENT: 仅有一段情景摘要
SUMMARY: 一句话
KEYWORDS: a, b
`
    const result = parseUnifiedMemoryText(text)
    expect(result).not.toBeNull()
    expect(result!.narrative?.content).toBe('仅有一段情景摘要')
    expect(result!.event_log).toBeUndefined()
    expect(result!.foresight).toBeUndefined()
    expect(result!.profile).toBeUndefined()
  })

  it('无 CONTENT 的 NARRATIVE 不写入 narrative', () => {
    const text = `
## NARRATIVE
SUMMARY: 只有摘要没有 CONTENT
KEYWORDS: x
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative).toBeUndefined()
  })

  it('PROFILE 无 ITEM 时不写入', () => {
    expect(parseUnifiedMemoryText('## PROFILE\n')).toBeNull()
    expect(parseUnifiedMemoryText('## PROFILE\nUSER_NAME: 张三')).toBeNull()
  })

  it('无任何有效内容时返回 null', () => {
    expect(parseUnifiedMemoryText('')).toBeNull()
    expect(parseUnifiedMemoryText('   \n  \n')).toBeNull()
    expect(parseUnifiedMemoryText('## NARRATIVE\nSUMMARY: 无 CONTENT')).toBeNull()
  })

  it('小节标题大小写不敏感（解析器转大写）', () => {
    const text = `
## episode
CONTENT: 小写标题
SUMMARY: 测试
KEYWORDS: k
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative?.content).toBe('小写标题')
  })

  it('Windows 换行 \\r\\n 正常解析', () => {
    const text =
      '## EPISODE\r\nCONTENT: 内容\r\nSUMMARY: 摘要\r\nKEYWORDS: a, b\r\n\r\n## EVENT_LOG\r\nTIME: 2025-02-15\r\nFACT: 事实1\r\n'
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative?.content).toBe('内容')
    expect(result?.event_log?.atomic_fact).toEqual(['事实1'])
  })

  it('前后空白 trim 后仍能解析', () => {
    const result = parseUnifiedMemoryText('\n  \n' + fullExpectedOutput + '\n  ')
    expect(result?.narrative?.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result?.profile?.user_profiles?.[0]).toBeDefined()
    const p = result!.profile!.user_profiles![0] as Record<string, unknown>
    expect(p.items).toBeDefined()
  })
})
