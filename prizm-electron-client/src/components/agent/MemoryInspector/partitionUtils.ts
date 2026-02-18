import type { MemoryPartition, MemoryItemWithGroup, SubCategory } from './types'
import { MEMORY_TYPE_LABELS, DOC_SUB_TYPE_LABELS, USER_SUBCAT_LABELS } from './constants'

function getPartition(item: MemoryItemWithGroup, scope: string): MemoryPartition {
  if (item.memory_layer === 'user') return 'user'
  if (item.memory_layer === 'scope') return 'scope'
  if (item.memory_layer === 'session') return 'session'
  const groupId = item.group_id
  if (!groupId || groupId === 'user') return 'user'
  if (groupId.startsWith(`${scope}:session:`)) return 'session'
  return 'scope'
}

export function partitionMemories(
  memories: MemoryItemWithGroup[],
  scope: string
): Record<MemoryPartition, MemoryItemWithGroup[]> {
  const user: MemoryItemWithGroup[] = []
  const scopeList: MemoryItemWithGroup[] = []
  const session: MemoryItemWithGroup[] = []
  for (const m of memories) {
    const p = getPartition(m, scope)
    if (p === 'user') user.push(m)
    else if (p === 'scope') scopeList.push(m)
    else session.push(m)
  }
  return { user, scope: scopeList, session }
}

export function subdivideUser(list: MemoryItemWithGroup[]): SubCategory[] {
  const byKey: Record<string, MemoryItemWithGroup[]> = {}
  for (const m of list) {
    const key = m.memory_type && USER_SUBCAT_LABELS[m.memory_type] ? m.memory_type : 'profile'
    if (!byKey[key]) byKey[key] = []
    byKey[key].push(m)
  }
  return Object.entries(byKey).map(([key, items]) => ({
    key,
    label: USER_SUBCAT_LABELS[key] ?? '用户画像',
    list: items
  }))
}

export function subdivideScope(list: MemoryItemWithGroup[], _scope: string): SubCategory[] {
  const byType: Record<string, MemoryItemWithGroup[]> = {}
  for (const m of list) {
    const type = m.memory_type || 'narrative'
    if (!byType[type]) byType[type] = []
    byType[type].push(m)
  }

  const TYPE_ORDER = ['narrative', 'foresight', 'document', 'event_log']
  const sortedKeys = Object.keys(byType).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a)
    const bi = TYPE_ORDER.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  const out: SubCategory[] = []
  for (const type of sortedKeys) {
    if (type === 'document') {
      const bySubType: Record<string, MemoryItemWithGroup[]> = {}
      for (const m of byType[type]) {
        const sub = (m as any).sub_type || 'overview'
        if (!bySubType[sub]) bySubType[sub] = []
        bySubType[sub].push(m)
      }
      const subOrder = ['overview', 'fact', 'migration']
      const sortedSubs = Object.keys(bySubType).sort((a, b) => {
        const ai = subOrder.indexOf(a)
        const bi = subOrder.indexOf(b)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
      for (const sub of sortedSubs) {
        out.push({
          key: `document:${sub}`,
          label: `文档${DOC_SUB_TYPE_LABELS[sub] || sub}（${bySubType[sub].length}）`,
          list: bySubType[sub]
        })
      }
    } else {
      out.push({
        key: type,
        label: MEMORY_TYPE_LABELS[type] || type,
        list: byType[type]
      })
    }
  }
  return out
}

export function subdivideSession(list: MemoryItemWithGroup[], scope: string): SubCategory[] {
  const prefix = `${scope}:session:`
  const bySession: Record<string, MemoryItemWithGroup[]> = {}
  for (const m of list) {
    const g = m.group_id ?? ''
    const sessionId = g.startsWith(prefix) ? g.slice(prefix.length) || 'default' : 'default'
    if (!bySession[sessionId]) bySession[sessionId] = []
    bySession[sessionId].push(m)
  }
  const entries = Object.entries(bySession)
  entries.sort((a, b) => {
    const aTime = a[1][0]?.created_at ?? ''
    const bTime = b[1][0]?.created_at ?? ''
    return bTime.localeCompare(aTime)
  })
  return entries.map(([sessionId, items], idx) => ({
    key: sessionId,
    label: `会话 #${entries.length - idx} (${
      sessionId.length > 8 ? sessionId.slice(0, 8) + '…' : sessionId
    }) · ${items.length} 条`,
    list: items
  }))
}
