import { describe, it, expect } from 'vitest'
import { getRegistryKey } from './skillRegistryKey'

describe('skillRegistryKey', () => {
  it('same source/owner/repo/skillPath produces same key', () => {
    const key = getRegistryKey({
      source: 'github',
      owner: 'foo',
      repo: 'bar',
      skillPath: 'skills/code-review'
    })
    expect(key).toBe('github:foo/bar:skills/code-review')
    expect(
      getRegistryKey({
        source: 'github',
        owner: 'foo',
        repo: 'bar',
        skillPath: 'skills/code-review'
      })
    ).toBe(key)
  })

  it('different name but same owner/repo/path segment produces different key when skillPath differs', () => {
    const key1 = getRegistryKey({
      source: 'github',
      owner: 'org',
      repo: 'repo',
      skillPath: 'skills/skill-a'
    })
    const key2 = getRegistryKey({
      source: 'github',
      owner: 'org',
      repo: 'repo',
      skillPath: 'skills/skill-b'
    })
    expect(key1).not.toBe(key2)
    expect(key1).toBe('github:org/repo:skills/skill-a')
    expect(key2).toBe('github:org/repo:skills/skill-b')
  })

  it('same name from different source produces different key', () => {
    const github = getRegistryKey({
      source: 'github',
      owner: 'a',
      repo: 'r',
      skillPath: 'skills/code-review'
    })
    const skillkit = getRegistryKey({
      source: 'skillkit',
      owner: 'a',
      repo: 'r',
      skillPath: 'skills/code-review'
    })
    expect(github).not.toBe(skillkit)
    expect(github).toBe('github:a/r:skills/code-review')
    expect(skillkit).toBe('skillkit:a/r:skills/code-review')
  })

  it('same name from different owner/repo produces different key', () => {
    const k1 = getRegistryKey({
      source: 'github',
      owner: 'org1',
      repo: 'repo1',
      skillPath: 'skills/code-review'
    })
    const k2 = getRegistryKey({
      source: 'github',
      owner: 'org2',
      repo: 'repo2',
      skillPath: 'skills/code-review'
    })
    expect(k1).not.toBe(k2)
  })
})
