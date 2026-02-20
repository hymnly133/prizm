/**
 * 联网搜索模块统一导出
 */

export type {
  WebSearchResult,
  WebFetchResult,
  WebSearchOptions,
  WebFetchOptions,
  WebSearchProvider
} from './types'

export { TavilyProvider } from './tavilyProvider'
export { BraveProvider } from './braveProvider'
export { fetchUrlContent } from './contentExtractor'
export { extractDomain } from './utils'
export {
  webSearch,
  webFetch,
  getActiveProvider,
  formatSearchResults,
  formatFetchResult
} from './webSearchService'
