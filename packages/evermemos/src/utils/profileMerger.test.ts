import { describe, it, expect } from 'vitest'
import { mergeProfilesSimple, mergeProfilesWithLLM } from './profileMerger.js'
import type { IProfileMergeLLM } from './profileMerger.js'

describe('mergeProfilesSimple', () => {
  it('should add new items to existing', () => {
    const existing = { items: ['用户是前端工程师'] }
    const incoming = { items: ['用户喜欢 TypeScript'] }

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(true)
    const items = result.merged.items as string[]
    expect(items).toHaveLength(2)
    expect(items).toContain('用户是前端工程师')
    expect(items).toContain('用户喜欢 TypeScript')
  })

  it('should not add duplicate items', () => {
    const existing = { items: ['用户擅长 TypeScript'] }
    const incoming = { items: ['用户擅长 TypeScript'] }

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(false)
  })

  it('should deduplicate items by normalized text', () => {
    const existing = {
      items: ['用户喜欢 TypeScript', '用户是前端工程师']
    }
    const incoming = {
      items: ['用户喜欢 typescript', '用户热爱开源']
    }

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(true)
    const items = result.merged.items as string[]
    expect(items).toHaveLength(3)
    expect(items).toContain('用户喜欢 TypeScript')
    expect(items).toContain('用户是前端工程师')
    expect(items).toContain('用户热爱开源')
  })

  it('should handle empty incoming profile', () => {
    const existing = { items: ['用户喜欢编程'] }
    const incoming = {}

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(false)
    expect(result.merged.items).toEqual(['用户喜欢编程'])
  })

  it('should handle empty existing profile', () => {
    const existing = {}
    const incoming = { items: ['用户喜欢编程', '用户是后端开发'] }

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(true)
    expect(result.merged.items).toEqual(['用户喜欢编程', '用户是后端开发'])
  })

  it('should normalize Chinese punctuation for dedup', () => {
    const existing = { items: ['用户喜欢华语流行音乐。'] }
    const incoming = { items: ['用户喜欢华语流行音乐'] }

    const result = mergeProfilesSimple(existing, incoming)
    expect(result.hasChanges).toBe(false)
  })
})

describe('mergeProfilesWithLLM', () => {
  it('should use LLM merged result', async () => {
    const mockProvider: IProfileMergeLLM = {
      generate: async () =>
        JSON.stringify({
          merged_profile: {
            items: ['用户擅长 TypeScript', '用户擅长 Python', '用户是全栈工程师']
          },
          changes_summary: 'Merged items'
        })
    }

    const existing = { items: ['用户擅长 TypeScript'] }
    const incoming = { items: ['用户擅长 Python', '用户是全栈工程师'] }

    const result = await mergeProfilesWithLLM(existing, incoming, mockProvider)
    expect(result.hasChanges).toBe(true)
    const items = result.merged.items as string[]
    expect(items).toHaveLength(3)
    expect(result.changesSummary).toBe('Merged items')
  })

  it('should fallback to simple merge on LLM failure', async () => {
    const failingProvider: IProfileMergeLLM = {
      generate: async () => {
        throw new Error('LLM unavailable')
      }
    }

    const existing = { items: ['用户喜欢编程'] }
    const incoming = { items: ['用户喜欢音乐'] }

    const result = await mergeProfilesWithLLM(existing, incoming, failingProvider)
    expect(result.hasChanges).toBe(true)
    const items = result.merged.items as string[]
    expect(items).toContain('用户喜欢编程')
    expect(items).toContain('用户喜欢音乐')
  })

  it('should fallback on invalid JSON response', async () => {
    const badProvider: IProfileMergeLLM = {
      generate: async () => 'not json'
    }

    const existing = { items: [] as string[] }
    const incoming = { items: ['用户喜欢 Go'] }

    const result = await mergeProfilesWithLLM(existing, incoming, badProvider)
    expect(result.hasChanges).toBe(true)
    expect(result.merged.items).toEqual(['用户喜欢 Go'])
  })
})
