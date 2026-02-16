import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { cjkTokenize, parseKeywords, keywordSearch } from './keywordSearch'
import { miniSearch } from './miniSearchRunner'
import { SearchIndexService } from './searchIndexService'
import { ripgrepSearch } from './ripgrepSearch'

describe('cjkTokenize', () => {
  it('should tokenize CJK text using jieba segmentation', () => {
    const tokens = cjkTokenize('竞品分析')
    expect(tokens).toContain('竞品')
    expect(tokens).toContain('分析')
    expect(tokens.length).toBeGreaterThan(0)
  })

  it('should tokenize mixed CJK + Latin text', () => {
    const tokens = cjkTokenize('Prizm产品定位')
    expect(tokens).toContain('Prizm')
    expect(tokens).toContain('产品')
    expect(tokens).toContain('定位')
  })

  it('should handle pure Latin text like default tokenizer', () => {
    const tokens = cjkTokenize('hello world test')
    expect(tokens).toEqual(['hello', 'world', 'test'])
  })

  it('should handle empty string', () => {
    expect(cjkTokenize('')).toEqual([])
  })

  it('should handle single CJK character', () => {
    const tokens = cjkTokenize('品')
    expect(tokens.length).toBeGreaterThan(0)
  })

  it('should handle CJK with punctuation', () => {
    const tokens = cjkTokenize('产品，定位')
    expect(tokens).toContain('产品')
    expect(tokens).toContain('定位')
  })

  it('should use cutForSearch for finer granularity', () => {
    const tokens = cjkTokenize('深度学习算法')
    expect(tokens).toContain('深度')
    expect(tokens).toContain('学习')
    expect(tokens.length).toBeGreaterThan(0)
  })
})

describe('parseKeywords', () => {
  it('should split by spaces, commas, semicolons, Chinese punctuation', () => {
    expect(parseKeywords('竞品 产品，分析；测试、验证')).toEqual([
      '竞品',
      '产品',
      '分析',
      '测试',
      '验证'
    ])
  })

  it('should handle array input', () => {
    expect(parseKeywords(['竞品', '产品'])).toEqual(['竞品', '产品'])
  })
})

describe('miniSearch (CJK integration)', () => {
  const items = [
    {
      title: 'Prizm产品定位与竞品深度分析',
      text: 'Prizm产品定位与竞品深度分析\n为了帮你更清晰地找到 Prizm 的切入点，我进行了深度挖掘',
      raw: { id: '1', title: 'Prizm产品定位与竞品深度分析' }
    },
    {
      title: '每日工作记录',
      text: '每日工作记录\n今天完成了三个任务',
      raw: { id: '2', title: '每日工作记录' }
    },
    {
      title: 'Meeting notes',
      text: 'Meeting notes\nDiscussed project timeline and deliverables',
      raw: { id: '3', title: 'Meeting notes' }
    }
  ]

  it('should find Chinese document by searching "竞品"', () => {
    const results = miniSearch('竞品', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })

  it('should find Chinese document by searching "产品"', () => {
    const results = miniSearch('产品', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })

  it('should find Chinese document by searching "分析"', () => {
    const results = miniSearch('分析', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })

  it('should find document by searching "Prizm"', () => {
    const results = miniSearch('Prizm', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })

  it('should find English document by searching "meeting"', () => {
    const results = miniSearch('meeting', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '3')
  })

  it('should find Chinese document by searching "工作"', () => {
    const results = miniSearch('工作', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '2')
  })

  it('should handle multi-keyword Chinese search', () => {
    const results = miniSearch('竞品 分析', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })
})

describe('keywordSearch (CJK integration)', () => {
  const items = [
    {
      title: 'Prizm产品定位与竞品深度分析',
      text: 'Prizm产品定位与竞品深度分析\n为了帮你更清晰地找到 Prizm 的切入点',
      raw: { id: '1' }
    },
    {
      title: '每日工作记录',
      text: '每日工作记录\n今天完成了三个任务',
      raw: { id: '2' }
    }
  ]

  it('should find "竞品" via substring matching', () => {
    const results = keywordSearch('竞品', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })

  it('should find "产品" via substring matching', () => {
    const results = keywordSearch('产品', items)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toHaveProperty('id', '1')
  })
})

describe('SearchIndexService - Phase 1 (MiniSearch)', () => {
  it('should find results via MiniSearch index', async () => {
    const service = new SearchIndexService()
    const scope = '__test_phase1__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: 'Prizm产品定位与竞品深度分析',
      content: '为了帮你更清晰地找到 Prizm 的切入点，我进行了深度挖掘'
    })
    await service.addDocument(scope, {
      id: 'doc2',
      title: '每日工作总结',
      content: '今天完成了三个开发任务和代码review'
    })

    const results = await service.search(scope, '竞品', { complete: false })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('doc1')
    expect(results[0].source).toBe('index')
  })

  it('should find "产品" via MiniSearch', async () => {
    const service = new SearchIndexService()
    const scope = '__test_phase1_2__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: 'Prizm产品定位与竞品深度分析',
      content: '深度挖掘竞品和产品定位'
    })

    const results = await service.search(scope, '产品', { complete: false })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('doc1')
  })

  it('should correctly tag source as index', async () => {
    const service = new SearchIndexService()
    const scope = '__test_source__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: '产品分析报告',
      content: '这是一份关于产品分析的报告'
    })

    const results = await service.search(scope, '产品', { complete: false })
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.source).toBe('index')
    }
  })
})

describe('SearchIndexService - tag filtering', () => {
  it('should filter results by tags', async () => {
    const service = new SearchIndexService()
    const scope = '__test_tags__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: '前端开发笔记',
      content: 'React hooks 使用心得',
      tags: ['前端', '开发']
    })
    await service.addDocument(scope, {
      id: 'doc2',
      title: '后端架构设计',
      content: 'Node.js 微服务架构',
      tags: ['后端', '架构']
    })
    await service.addDocument(scope, {
      id: 'doc3',
      title: '全栈开发指南',
      content: '前后端开发最佳实践',
      tags: ['前端', '后端']
    })

    // 搜索 "开发" 并过滤 tag=前端
    const results = await service.search(scope, '开发', { tags: ['前端'] })
    expect(results.length).toBe(2)
    const ids = results.map((r) => r.id)
    expect(ids).toContain('doc1')
    expect(ids).toContain('doc3')
    expect(ids).not.toContain('doc2')
  })

  it('should return all results when no tags filter', async () => {
    const service = new SearchIndexService()
    const scope = '__test_tags_none__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: '开发笔记A',
      content: '开发内容A',
      tags: ['tagA']
    })
    await service.addDocument(scope, {
      id: 'doc2',
      title: '开发笔记B',
      content: '开发内容B',
      tags: ['tagB']
    })

    const results = await service.search(scope, '开发')
    expect(results.length).toBe(2)
  })

  it('tags filter with OR logic (match any tag)', async () => {
    const service = new SearchIndexService()
    const scope = '__test_tags_or__'

    await service.addDocument(scope, {
      id: 'doc1',
      title: '笔记A',
      content: '测试内容',
      tags: ['alpha']
    })
    await service.addDocument(scope, {
      id: 'doc2',
      title: '笔记B',
      content: '测试内容',
      tags: ['beta']
    })
    await service.addDocument(scope, {
      id: 'doc3',
      title: '笔记C',
      content: '测试内容',
      tags: ['gamma']
    })

    const results = await service.search(scope, '测试', { tags: ['alpha', 'beta'] })
    expect(results.length).toBe(2)
    const ids = results.map((r) => r.id)
    expect(ids).toContain('doc1')
    expect(ids).toContain('doc2')
    expect(ids).not.toContain('doc3')
  })
})

describe('ripgrepSearch', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prizm-rg-test-'))
    fs.writeFileSync(
      path.join(tmpDir, 'doc1.md'),
      [
        '---',
        'id: doc1',
        'title: Prizm产品定位与竞品深度分析',
        'prizm_type: document',
        'tags:',
        '  - 竞品',
        '  - 产品',
        '---',
        '',
        'Prizm产品定位与竞品深度分析。',
        '为了帮你更清晰地找到 Prizm 的切入点，我进行了深度挖掘。'
      ].join('\n'),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(tmpDir, 'doc2.md'),
      [
        '---',
        'id: doc2',
        'title: 每日工作记录',
        'prizm_type: document',
        '---',
        '',
        '今天完成了三个任务，还进行了代码review。'
      ].join('\n'),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(tmpDir, 'readme.txt'),
      'This is not a markdown file and should not match.',
      'utf-8'
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should find Chinese text in .md files', async () => {
    const results = await ripgrepSearch('竞品', tmpDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].filePath).toContain('doc1.md')
  })

  it('should find "产品" in .md files', async () => {
    const results = await ripgrepSearch('产品', tmpDir)
    expect(results.length).toBeGreaterThan(0)
    const filePaths = results.map((r) => r.filePath)
    expect(filePaths.some((p) => p.includes('doc1.md'))).toBe(true)
  })

  it('should not match non-.md files by default', async () => {
    const results = await ripgrepSearch('markdown', tmpDir)
    expect(results.length).toBe(0)
  })

  it('should find text in doc2', async () => {
    const results = await ripgrepSearch('代码review', tmpDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].filePath).toContain('doc2.md')
  })

  it('should return empty for non-matching query', async () => {
    const results = await ripgrepSearch('完全不存在的词汇zzzzz', tmpDir)
    expect(results.length).toBe(0)
  })

  it('should respect maxMatchesPerFile', async () => {
    const results = await ripgrepSearch('Prizm', tmpDir, { maxMatchesPerFile: 1 })
    for (const r of results) {
      expect(r.matches.length).toBeLessThanOrEqual(1)
    }
  })

  it('should be case insensitive by default', async () => {
    const results = await ripgrepSearch('prizm', tmpDir)
    expect(results.length).toBeGreaterThan(0)
  })
})
