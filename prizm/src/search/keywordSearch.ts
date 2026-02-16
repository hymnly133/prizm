/**
 * 通用关键词搜索 - 面向自然语言与大模型
 * 不使用向量 embedding，采用高效、通用、高宽容度的关键词匹配算法
 *
 * 设计原则：
 * - 输入：关键词列表（支持字符串自动分词）
 * - 输出：按相关性排序的文档列表
 * - 高宽容度：子串匹配、OR 逻辑、大模型可对结果二次理解
 */

import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict.js'

/** 全局 jieba 实例（带内置词典，Rust 原生性能） */
const jieba = Jieba.withDict(dict)

/** CJK 统一表意文字 Unicode 范围（基本区 + 扩展A + 兼容表意） */
const CJK_SEQ_RE = /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+)/
const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

/**
 * CJK-aware tokenizer for MiniSearch，基于 jieba 中文分词
 * - CJK text: 使用 jieba cutForSearch（搜索引擎模式，更细粒度）
 * - Non-CJK text: splits on word boundaries (spaces, punctuation) like default MiniSearch
 *
 * Example: "Prizm产品定位" → ["Prizm", "产品", "定位"]
 */
export function cjkTokenize(text: string): string[] {
  if (!text) return []
  const tokens: string[] = []
  const segments = text.split(CJK_SEQ_RE)

  for (const seg of segments) {
    if (!seg) continue
    if (CJK_CHAR_RE.test(seg)) {
      const words = jieba.cutForSearch(seg, true)
      for (const w of words) {
        const trimmed = w.trim()
        if (trimmed.length > 0) tokens.push(trimmed)
      }
    } else {
      const words = seg.split(/[^\w]+/).filter((w) => w.length > 0)
      tokens.push(...words)
    }
  }
  return tokens
}

export interface SearchableItem {
  /** 用于匹配的文本（标题 + 正文拼接） */
  text: string
  /** 可选的标题（匹配时加权） */
  title?: string
  /** 原始数据引用 */
  raw?: unknown
}

export interface KeywordSearchOptions {
  /** 匹配模式：'any' 任一关键词命中即包含，'all' 需全部命中 */
  mode?: 'any' | 'all'
  /** 最大返回数量，默认 50 */
  limit?: number
  /** 是否区分大小写，默认 false（不区分） */
  caseSensitive?: boolean
}

export interface ScoredItem<T = unknown> {
  item: T
  score: number
  /** 命中的关键词 */
  matchedKeywords: string[]
}

/**
 * 从自然语言或关键词字符串中解析出关键词列表
 * 支持：空格、逗号、分号、换行、中文顿号等分隔
 */
export function parseKeywords(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input
      .flatMap((s) => (typeof s === 'string' ? s : '').split(/[\s,;，；、\n]+/))
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  }
  return (input || '')
    .split(/[\s,;，；、\n]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * 计算单个文档对关键词列表的匹配分数
 * 算法：简单 TF 风格 - 每个关键词命中 +1，标题命中 +0.5 加成
 * 高宽容度：子串匹配，不要求完整词边界
 */
function computeScore(
  text: string,
  title: string | undefined,
  keywords: string[],
  caseSensitive: boolean
): { score: number; matched: string[] } {
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase())
  const t = norm(text)
  const tit = title ? norm(title) : ''

  let score = 0
  const matched: string[] = []

  for (const kw of keywords) {
    const k = norm(kw)
    if (k.length === 0) continue

    const inText = t.includes(k)
    const inTitle = tit && tit.includes(k)

    if (inText || inTitle) {
      matched.push(kw)
      score += 1
      if (inTitle) score += 0.5 // 标题命中加权
      if (inText) {
        // 多次出现轻微加分（避免长文档过度占优）
        const count = (t.match(new RegExp(escapeRegex(k), 'g')) || []).length
        if (count > 1) score += Math.min(count - 1, 2) * 0.3
      }
    }
  }

  return { score, matched }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 关键词搜索主函数
 * @param keywords 关键词列表或可分词字符串
 * @param items 待搜索的文档列表
 * @param options 搜索选项
 */
export function keywordSearch<T extends SearchableItem>(
  keywords: string | string[],
  items: T[],
  options: KeywordSearchOptions = {}
): ScoredItem<T['raw'] extends infer R ? R : T>[] {
  const kw = parseKeywords(keywords)
  if (kw.length === 0) return []

  const { mode = 'any', limit = 50, caseSensitive = false } = options

  const scored: ScoredItem<T['raw'] extends infer R ? R : T>[] = []

  for (const item of items) {
    const { score, matched } = computeScore(item.text, item.title, kw, caseSensitive)

    if (mode === 'all' && matched.length < kw.length) continue
    if (mode === 'any' && matched.length === 0) continue

    scored.push({
      item: (item.raw ?? item) as T['raw'] extends infer R ? R : T,
      score,
      matchedKeywords: matched
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return 0
  })

  return scored.slice(0, limit)
}
