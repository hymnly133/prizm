import type { MemoryItem } from '@prizm/client-core'

export type SearchMethod = 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic'

export type MemoryPartition = 'user' | 'scope' | 'session'

/** Memory item extended with optional group_id from list/search API */
export type MemoryItemWithGroup = MemoryItem & { group_id?: string | null }

export interface SubCategory {
  key: string
  label: string
  list: MemoryItemWithGroup[]
}
