/**
 * E2E：使用真实默认模型（小米 MiMo，需 XIAOMIMIMO_API_KEY）+ 多种场景对话，
 * 检查提示词在各场景下是否都能抽到期望的维度（NARRATIVE / EVENT_LOG / FORESIGHT / PROFILE）。
 * 无 API Key 时整组跳过。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { UnifiedExtractor, RawDataType } from '@prizm/evermemos'
import type { MemCell } from '@prizm/evermemos'
import { createMemoryExtractionLLMAdapter } from './EverMemService'

const hasMimoKey = !!process.env.XIAOMIMIMO_API_KEY?.trim()

type Round = { role: string; content: string; timestamp: string }

type Scenario = {
  name: string
  rounds: Round[]
  /** 该场景下期望至少抽到叙事记忆 */
  expectNarrative: boolean
  /** 该场景下期望至少抽到事件日志（原子事实） */
  expectEventLog: boolean
  /** 该场景下期望至少抽到前瞻 */
  expectForesight: boolean
  /** 该场景下期望至少抽到用户画像 */
  expectProfile: boolean
}

const scenarios: Scenario[] = [
  {
    name: '项目进度与计划（含时间节点、技术栈、评审约定）',
    rounds: [
      {
        role: 'user',
        content: '我这边想跟你对一下项目进度，下周要汇报。',
        timestamp: '2025-02-15T09:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '好的，你这边目前卡在哪一块？我可以先帮你理一理。',
        timestamp: '2025-02-15T09:01:00.000Z'
      },
      {
        role: 'user',
        content: '设计稿周三前要定稿，我负责前端，用 TypeScript 和 React。评审想约下周一下午。',
        timestamp: '2025-02-15T09:02:00.000Z'
      },
      {
        role: 'assistant',
        content: '可以，周三前设计稿定稿、下周一下午评审，我记下了。',
        timestamp: '2025-02-15T09:03:00.000Z'
      },
      {
        role: 'user',
        content: '行，协作就按现在流程来，有进展再同步。',
        timestamp: '2025-02-15T09:04:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: true,
    expectForesight: true,
    expectProfile: true
  },
  {
    name: '纯事实事件（今日做了哪些事）',
    rounds: [
      {
        role: 'user',
        content: '今天上午开了需求评审会，产品定了三个优先级。',
        timestamp: '2025-02-15T10:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '然后呢？',
        timestamp: '2025-02-15T10:01:00.000Z'
      },
      {
        role: 'user',
        content: '下午把登录页重构的 PR 提了，晚上和同事约了饭，聊了聊转岗的事。',
        timestamp: '2025-02-15T10:02:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: true,
    expectForesight: false,
    expectProfile: false
  },
  {
    name: '用户画像为主（自我介绍、技能与偏好）',
    rounds: [
      {
        role: 'user',
        content: '我目前做后端开发，主要用 Go 和 Python，带一个小团队。',
        timestamp: '2025-02-15T11:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '平时决策风格偏数据驱动还是直觉？',
        timestamp: '2025-02-15T11:01:00.000Z'
      },
      {
        role: 'user',
        content: '比较看重数据，但也会凭经验拍板。兴趣是跑步和看书，周末一般会留半天给自己。',
        timestamp: '2025-02-15T11:02:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: false,
    expectForesight: false,
    expectProfile: true
  },
  {
    name: '未来规划与承诺（时间节点明确）',
    rounds: [
      {
        role: 'user',
        content: '我打算下周开始写技术方案，月底前给一版初稿。',
        timestamp: '2025-02-15T14:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '需要我帮你拆成任务列表吗？',
        timestamp: '2025-02-15T14:01:00.000Z'
      },
      {
        role: 'user',
        content: '可以，另外 3 月第一周想排一次架构评审，你记一下。',
        timestamp: '2025-02-15T14:02:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: true,
    expectForesight: true,
    expectProfile: false
  },
  {
    name: '混合日常（事实+计划+一点自我描述）',
    rounds: [
      {
        role: 'user',
        content:
          '昨天把数据库迁移跑完了，今天在修测试用例。我是负责 infra 的，习惯先保证稳定再上功能。',
        timestamp: '2025-02-15T15:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '接下来有什么计划？',
        timestamp: '2025-02-15T15:01:00.000Z'
      },
      {
        role: 'user',
        content: '这周五前把监控告警接好，下周和业务方对一下容量预估。',
        timestamp: '2025-02-15T15:02:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: true,
    expectForesight: true,
    expectProfile: true
  },
  {
    name: '极简对话（仅一两句）',
    rounds: [
      {
        role: 'user',
        content: '在吗？帮忙看下这个报错。',
        timestamp: '2025-02-15T16:00:00.000Z'
      },
      {
        role: 'assistant',
        content: '在，把堆栈贴过来吧。',
        timestamp: '2025-02-15T16:01:00.000Z'
      }
    ],
    expectNarrative: true,
    expectEventLog: false,
    expectForesight: false,
    expectProfile: false
  }
]

function buildMemCell(rounds: Round[], eventId: string): MemCell {
  return {
    event_id: eventId,
    user_id: 'e2e-user',
    type: RawDataType.CONVERSATION,
    original_data: rounds,
    timestamp: rounds[rounds.length - 1]?.timestamp ?? new Date().toISOString(),
    scene: 'assistant'
  }
}

function assertResultShape(r: NonNullable<Awaited<ReturnType<UnifiedExtractor['extractAll']>>>) {
  if (r.narrative) {
    expect(r.narrative.content, 'NARRATIVE.CONTENT 应为非空字符串').toBeTruthy()
    expect(typeof r.narrative.content).toBe('string')
    if (r.narrative.summary) expect(typeof r.narrative.summary).toBe('string')
    if (r.narrative.keywords) {
      expect(Array.isArray(r.narrative.keywords)).toBe(true)
      r.narrative.keywords.forEach((k) => expect(typeof k).toBe('string'))
    }
  }
  if (r.event_log?.atomic_fact?.length) {
    r.event_log.atomic_fact.forEach((f) => expect(typeof f).toBe('string'))
  }
  if (r.event_log?.time) expect(typeof r.event_log.time).toBe('string')
  if (r.foresight?.length) {
    r.foresight.forEach((item) => {
      expect(item.content, 'FORESIGHT 条目的 content 应为非空').toBeTruthy()
      expect(typeof item.content).toBe('string')
    })
  }
  if (r.profile?.user_profiles?.length) {
    const p = r.profile.user_profiles[0] as Record<string, unknown>
    expect(p.user_id === undefined || typeof p.user_id === 'string').toBe(true)
  }
}

describe.skipIf(!hasMimoKey)('记忆抽取 E2E（小米 MiMo + 多场景对话）', () => {
  let extractor: UnifiedExtractor

  beforeAll(() => {
    const adapter = createMemoryExtractionLLMAdapter()
    extractor = new UnifiedExtractor(adapter)
  })

  it.each(scenarios.map((s, i) => [s.name, s, i] as const))(
    '场景「%s」应抽到期望维度',
    async (_, scenario, index) => {
      const memcell = buildMemCell(scenario.rounds, `e2e-ev-${index}`)
      const result = await extractor.extractAll(memcell)

      expect(result, `[${scenario.name}] 统一抽取应返回非 null`).not.toBeNull()
      const r = result!

      assertResultShape(r)

      if (scenario.expectNarrative) {
        expect(
          r.narrative?.content,
          `[${scenario.name}] 期望抽到 NARRATIVE（叙事记忆）`
        ).toBeTruthy()
      }
      if (scenario.expectEventLog) {
        expect(
          r.event_log?.atomic_fact?.length,
          `[${scenario.name}] 期望抽到 EVENT_LOG（至少 1 条原子事实）`
        ).toBeGreaterThan(0)
      }
      if (scenario.expectForesight) {
        expect(
          r.foresight?.length,
          `[${scenario.name}] 期望抽到 FORESIGHT（至少 1 条前瞻）`
        ).toBeGreaterThan(0)
      }
      if (scenario.expectProfile) {
        expect(
          r.profile?.user_profiles?.length,
          `[${scenario.name}] 期望抽到 PROFILE（用户画像）`
        ).toBeGreaterThan(0)
      }

      expect(
        r.narrative?.content ||
          r.event_log?.atomic_fact?.length ||
          r.foresight?.length ||
          r.profile?.user_profiles?.length,
        `[${scenario.name}] 至少应抽到一类记忆`
      ).toBeTruthy()
    },
    60_000
  )
})
