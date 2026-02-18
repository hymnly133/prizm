import { describe, it, expect } from 'vitest'
import { parseUnifiedMemoryText } from './unifiedMemoryParser.js'

describe('parseUnifiedMemoryText', () => {
  /** 与提示词中 output_format 一致的期望输出样本（PROFILE 使用 ITEM 原子画像） */
  const fullExpectedOutput = `
## NARRATIVE
CONTENT: 用户讨论了项目进度与下周计划，约定周三前完成设计稿。
SUMMARY: 讨论项目进度与下周计划。

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
ITEM: 用户擅长 TypeScript 和 Node.js
ITEM: 用户负责前端开发与需求对接
ITEM: 用户热爱技术分享
`

  it('完整解析四类小节：NARRATIVE / EVENT_LOG / FORESIGHT / PROFILE', () => {
    const result = parseUnifiedMemoryText(fullExpectedOutput)
    expect(result).not.toBeNull()

    expect(result!.narrative?.content).toBe('用户讨论了项目进度与下周计划，约定周三前完成设计稿。')
    expect(result!.narrative?.summary).toBe('讨论项目进度与下周计划。')

    expect(result!.event_log?.atomic_fact).toEqual([
      '用户提出周三前完成设计稿。',
      '约定下周一下午开会评审。'
    ])

    expect(result!.foresight).toHaveLength(2)
    expect(result!.foresight![0].content).toBe('周三前需交付设计稿')
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
    expect(p.user_name).toBeUndefined()
  })

  it('值内包含英文冒号时仍按第一冒号切分键值', () => {
    const text = `
## NARRATIVE
CONTENT: 会议时间：明天下午 3:00，地点：A 会议室
SUMMARY: 时间：明天下午
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative?.content).toBe('会议时间：明天下午 3:00，地点：A 会议室')
    expect(result?.narrative?.summary).toBe('时间：明天下午')
  })

  it('EVENT_LOG 最多解析 10 条 FACT', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `FACT: 事实${i + 1}`).join('\n')
    const text = `
## EVENT_LOG
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
      (_, i) => `CONTENT: 前瞻${i + 1}\nEVIDENCE: 证据${i + 1}`
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
`
    const result = parseUnifiedMemoryText(text)
    expect(result?.narrative?.content).toBe('小写标题')
  })

  it('Windows 换行 \\r\\n 正常解析', () => {
    const text =
      '## EPISODE\r\nCONTENT: 内容\r\nSUMMARY: 摘要\r\n\r\n## EVENT_LOG\r\nFACT: 事实1\r\n'
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

  describe('Document FACTS → document_facts', () => {
    it('FACTS 段被映射到 document_facts 而非 event_log', () => {
      const text = `
## OVERVIEW
CONTENT: 文档主要描述了数据库设计方案

## FACTS
FACT: 使用 PostgreSQL 作为主数据库
FACT: 主键采用 UUID 类型
FACT: 索引策略使用 B-Tree + GIN
`
      const result = parseUnifiedMemoryText(text)
      expect(result).not.toBeNull()

      // OVERVIEW → narrative
      expect(result!.narrative?.content).toBe('文档主要描述了数据库设计方案')

      // FACTS → document_facts（不是 event_log）
      expect(result!.document_facts?.facts).toHaveLength(3)
      expect(result!.document_facts!.facts[0]).toBe('使用 PostgreSQL 作为主数据库')
      expect(result!.document_facts!.facts[2]).toBe('索引策略使用 B-Tree + GIN')

      // event_log 应为 undefined
      expect(result!.event_log).toBeUndefined()
    })

    it('FACTS 最多解析 20 条', () => {
      const lines = Array.from({ length: 25 }, (_, i) => `FACT: 文档事实${i + 1}`).join('\n')
      const text = `
## FACTS
${lines}
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.document_facts?.facts).toHaveLength(20)
      expect(result!.document_facts!.facts[0]).toBe('文档事实1')
      expect(result!.document_facts!.facts[19]).toBe('文档事实20')
    })

    it('仅有 document_facts 时返回有效结果', () => {
      const text = `
## FACTS
FACT: 唯一一条事实
`
      const result = parseUnifiedMemoryText(text)
      expect(result).not.toBeNull()
      expect(result!.document_facts?.facts).toEqual(['唯一一条事实'])
    })

    it('EVENT_LOG 和 FACTS 可以同时存在且互不干扰', () => {
      const text = `
## EVENT_LOG
FACT: 用户操作了文件

## FACTS
FACT: 文档记录了 API 设计
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.event_log?.atomic_fact).toEqual(['用户操作了文件'])
      expect(result!.document_facts?.facts).toEqual(['文档记录了 API 设计'])
    })
  })

  describe('多 NARRATIVE 解析（Pipeline 2 --- 分隔）', () => {
    it('用 --- 分隔的两个 NARRATIVE 话题段', () => {
      const text = `
## NARRATIVE
CONTENT: 用户讨论了前端框架选型，最终选择 React。
SUMMARY: 讨论前端框架选型
---
CONTENT: 用户分享了后端架构设计经验，推荐微服务。
SUMMARY: 分享后端架构设计
`
      const result = parseUnifiedMemoryText(text)
      expect(result).not.toBeNull()

      // 向后兼容：narrative 取第一个
      expect(result!.narrative?.content).toBe('用户讨论了前端框架选型，最终选择 React。')
      expect(result!.narrative?.summary).toBe('讨论前端框架选型')

      // 多 narrative 数组
      expect(result!.narratives).toHaveLength(2)
      expect(result!.narratives![0].content).toBe('用户讨论了前端框架选型，最终选择 React。')
      expect(result!.narratives![1].content).toBe('用户分享了后端架构设计经验，推荐微服务。')
      expect(result!.narratives![1].summary).toBe('分享后端架构设计')
    })

    it('三个 NARRATIVE 话题段', () => {
      const text = `
## NARRATIVE
CONTENT: 话题一
SUMMARY: 摘要一
---
CONTENT: 话题二
SUMMARY: 摘要二
---
CONTENT: 话题三
SUMMARY: 摘要三
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.narratives).toHaveLength(3)
      expect(result!.narratives![0].content).toBe('话题一')
      expect(result!.narratives![1].content).toBe('话题二')
      expect(result!.narratives![2].content).toBe('话题三')
      // 向后兼容：narrative = 第一个
      expect(result!.narrative?.content).toBe('话题一')
    })

    it('单个 NARRATIVE 不产生 narratives 数组（向后兼容）', () => {
      const text = `
## NARRATIVE
CONTENT: 只有一个话题段
SUMMARY: 单话题
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.narrative?.content).toBe('只有一个话题段')
      expect(result!.narratives).toBeUndefined()
    })

    it('多 NARRATIVE 中只有部分有 CONTENT（跳过无 CONTENT 的块）', () => {
      const text = `
## NARRATIVE
CONTENT: 有效话题一
SUMMARY: 摘要一
---
SUMMARY: 只有摘要没有 CONTENT 的块
---
CONTENT: 有效话题二
SUMMARY: 摘要二
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.narratives).toHaveLength(2)
      expect(result!.narratives![0].content).toBe('有效话题一')
      expect(result!.narratives![1].content).toBe('有效话题二')
    })

    it('多 NARRATIVE 与其他段（FORESIGHT / PROFILE）共存', () => {
      const text = `
## NARRATIVE
CONTENT: 话题一：AI 项目规划
SUMMARY: AI 项目规划
---
CONTENT: 话题二：团队协作改进
SUMMARY: 团队协作

## FORESIGHT
CONTENT: 用户可能会研究 LLM 部署方案
EVIDENCE: 用户提到想在自己的服务器上部署模型

## PROFILE
ITEM: 用户对 AI/LLM 技术有深入研究
`
      const result = parseUnifiedMemoryText(text)
      expect(result!.narratives).toHaveLength(2)
      expect(result!.foresight).toHaveLength(1)
      expect(result!.foresight![0].content).toBe('用户可能会研究 LLM 部署方案')
      expect(result!.profile?.user_profiles).toHaveLength(1)
      const p = result!.profile!.user_profiles![0] as Record<string, unknown>
      expect((p.items as string[])[0]).toBe('用户对 AI/LLM 技术有深入研究')
    })
  })
})
