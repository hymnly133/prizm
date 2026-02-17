import { describe, it, expect } from 'vitest'
import {
  checkSufficiency,
  generateRefinedQueries,
  type IAgenticCompletionProvider
} from './agenticRetrieval.js'
import type { SearchResult } from '../types.js'
import { MemoryType } from '../types.js'

function makeResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    score: 1 - i * 0.1,
    content: `Memory content ${i}`,
    metadata: {},
    type: MemoryType.EPISODIC_MEMORY
  }))
}

describe('checkSufficiency', () => {
  it('should return sufficient when LLM says so', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () =>
        JSON.stringify({
          is_sufficient: true,
          reasoning: 'All needed info is present',
          missing_information: []
        })
    }

    const result = await checkSufficiency('用户叫什么名字', makeResults(3), provider)
    expect(result.isSufficient).toBe(true)
    expect(result.missingInfo).toHaveLength(0)
  })

  it('should return insufficient with missing info', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () =>
        JSON.stringify({
          is_sufficient: false,
          reasoning: 'Missing user preferences',
          missing_information: ['用户偏好', '工作信息']
        })
    }

    const result = await checkSufficiency('用户的详细信息', makeResults(3), provider)
    expect(result.isSufficient).toBe(false)
    expect(result.missingInfo).toEqual(['用户偏好', '工作信息'])
  })

  it('should default to sufficient on parse failure', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () => 'not valid json at all'
    }

    const result = await checkSufficiency('query', makeResults(1), provider)
    expect(result.isSufficient).toBe(true)
  })
})

describe('generateRefinedQueries', () => {
  it('should return refined queries from LLM', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () =>
        JSON.stringify({
          queries: ['用户工作经历', '用户技能特长'],
          reasoning: 'Targeting missing areas'
        })
    }

    const queries = await generateRefinedQueries(
      '用户信息',
      makeResults(3),
      ['工作经历', '技能'],
      provider
    )
    expect(queries).toEqual(['用户工作经历', '用户技能特长'])
  })

  it('should filter out queries identical to original', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () =>
        JSON.stringify({
          queries: ['用户信息', '用户工作经历'],
          reasoning: 'test'
        })
    }

    const queries = await generateRefinedQueries('用户信息', makeResults(1), ['missing'], provider)
    expect(queries).toEqual(['用户工作经历'])
  })

  it('should fallback to original query on parse failure', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () => 'invalid'
    }

    const queries = await generateRefinedQueries('原始查询', makeResults(1), [], provider)
    expect(queries).toEqual(['原始查询'])
  })

  it('should limit to 3 queries max', async () => {
    const provider: IAgenticCompletionProvider = {
      generate: async () =>
        JSON.stringify({
          queries: ['q1', 'q2', 'q3', 'q4', 'q5'],
          reasoning: 'many queries'
        })
    }

    const queries = await generateRefinedQueries('原始查询', makeResults(1), [], provider)
    expect(queries.length).toBeLessThanOrEqual(3)
  })
})
