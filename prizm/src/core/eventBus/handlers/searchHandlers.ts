/**
 * 搜索索引事件处理器
 * 订阅文档变更事件，自动更新搜索索引
 */

import { subscribe } from '../eventBus'
import type { SearchIndexService } from '../../../search/searchIndexService'
import { createLogger } from '../../../logger'

const log = createLogger('SearchHandlers')

let searchIndex: SearchIndexService | null = null

/** 注入搜索索引服务引用（server.start 时调用） */
export function setSearchIndex(idx: SearchIndexService | null): void {
  searchIndex = idx
}

/** 注册搜索索引事件订阅 */
export function registerSearchHandlers(): void {
  subscribe(
    'document:saved',
    async (data) => {
      if (!searchIndex) return
      try {
        await searchIndex.addDocument(data.scope, {
          id: data.documentId,
          title: data.title,
          content: data.content
        })
      } catch (err) {
        log.warn('Search index update failed for document:saved', data.documentId, err)
      }
    },
    'searchIndex.documentSaved'
  )

  subscribe(
    'document:deleted',
    async (data) => {
      if (!searchIndex) return
      try {
        await searchIndex.removeDocument(data.scope, data.documentId)
      } catch (err) {
        log.warn('Search index remove failed for document:deleted', data.documentId, err)
      }
    },
    'searchIndex.documentDeleted'
  )

  log.info('Search index event handlers registered')
}
