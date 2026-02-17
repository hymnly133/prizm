/**
 * Prizm Server 默认剪贴板历史适配器
 */

import { createLogger } from '../logger'
import type { IClipboardAdapter } from './interfaces'
import type { ClipboardItem } from '../types'
import { scopeStore } from '../core/ScopeStore'
import { genUniqueId } from '../id'

const log = createLogger('Adapter')

export class DefaultClipboardAdapter implements IClipboardAdapter {
  async addItem(scope: string, item: Omit<ClipboardItem, 'id'>): Promise<ClipboardItem> {
    const data = scopeStore.getScopeData(scope)
    const record: ClipboardItem = {
      id: genUniqueId(),
      ...item
    }
    data.clipboard.unshift(record)
    scopeStore.saveScope(scope)
    log.info('Clipboard item added:', record.id, 'scope:', scope)
    return record
  }

  async getHistory(scope: string, options?: { limit?: number }): Promise<ClipboardItem[]> {
    const data = scopeStore.getScopeData(scope)
    const list = [...data.clipboard]
    if (typeof options?.limit === 'number') {
      return list.slice(0, options.limit)
    }
    return list
  }

  async deleteItem(scope: string, id: string): Promise<void> {
    const data = scopeStore.getScopeData(scope)
    const idx = data.clipboard.findIndex((c) => c.id === id)
    if (idx >= 0) {
      data.clipboard.splice(idx, 1)
      scopeStore.saveScope(scope)
      log.info('Clipboard item deleted:', id, 'scope:', scope)
    }
  }
}
