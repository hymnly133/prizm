/**
 * webSearch 模块单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractDomain } from './utils'
import { formatSearchResults, formatFetchResult } from './webSearchService'
import type { WebSearchResult, WebFetchResult } from './types'

describe('extractDomain', () => {
  it('从标准 URL 提取域名', () => {
    expect(extractDomain('https://www.example.com/path?q=1')).toBe('example.com')
  })

  it('保留子域名（非 www）', () => {
    expect(extractDomain('https://docs.github.com/en')).toBe('docs.github.com')
  })

  it('去除 www 前缀', () => {
    expect(extractDomain('https://www.stackoverflow.com')).toBe('stackoverflow.com')
  })

  it('无效 URL 返回空字符串', () => {
    expect(extractDomain('')).toBe('')
    expect(extractDomain('not-a-url')).toBe('')
  })

  it('处理带端口的 URL', () => {
    expect(extractDomain('http://localhost:3000/test')).toBe('localhost')
  })
})

describe('formatSearchResults', () => {
  it('空结果返回提示文本', () => {
    expect(formatSearchResults([])).toBe('未找到相关结果。')
  })

  it('格式化包含编号、域名、摘要', () => {
    const results: WebSearchResult[] = [
      {
        title: 'TypeScript 5.0 发布',
        url: 'https://devblogs.microsoft.com/typescript/ts-5-0',
        snippet: 'TypeScript 5.0 带来了装饰器和模块解析改进。',
        domain: 'devblogs.microsoft.com',
        pageAge: '2024-03-15'
      },
      {
        title: 'React 19 新特性',
        url: 'https://react.dev/blog/react-19',
        snippet: 'React 19 引入了 Actions 和新 hooks。',
        domain: 'react.dev'
      }
    ]
    const text = formatSearchResults(results)

    expect(text).toContain('找到 2 条结果')
    expect(text).toContain('[1] **TypeScript 5.0 发布** (devblogs.microsoft.com, 2024-03-15)')
    expect(text).toContain('[2] **React 19 新特性** (react.dev)')
    expect(text).toContain('装饰器和模块解析改进')
    expect(text).toContain('prizm_web_fetch')
  })

  it('无 pageAge 时不显示日期', () => {
    const results: WebSearchResult[] = [
      { title: 'Test', url: 'https://test.com', snippet: 'content', domain: 'test.com' }
    ]
    const text = formatSearchResults(results)
    expect(text).toContain('(test.com)')
    expect(text).not.toContain('undefined')
  })
})

describe('formatFetchResult', () => {
  it('格式化正常结果', () => {
    const result: WebFetchResult = {
      url: 'https://example.com/article',
      title: '示例文章',
      content: '这是文章正文内容...',
      totalChars: 20,
      truncated: false
    }
    const text = formatFetchResult(result)
    expect(text).toContain('# 示例文章')
    expect(text).toContain('来源: https://example.com/article')
    expect(text).toContain('这是文章正文内容...')
    expect(text).not.toContain('已截断')
  })

  it('截断结果显示提示', () => {
    const result: WebFetchResult = {
      url: 'https://example.com/long',
      title: '长文章',
      content: '部分内容...',
      totalChars: 50000,
      truncated: true
    }
    const text = formatFetchResult(result)
    expect(text).toContain('已截断')
    expect(text).toContain('50000')
  })

  it('无标题时不输出标题行', () => {
    const result: WebFetchResult = {
      url: 'https://api.example.com/data',
      title: '',
      content: '{"key": "value"}',
      totalChars: 16,
      truncated: false
    }
    const text = formatFetchResult(result)
    expect(text).not.toContain('# ')
    expect(text).toContain('来源: https://api.example.com/data')
  })
})
