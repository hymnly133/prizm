import { Button, Collapse, Select, InputNumber, Checkbox, Input } from 'antd'
import { Search } from 'lucide-react'
import { useRef } from 'react'
import type { SearchMethod } from './types'
import { MEMORY_TYPE_OPTIONS } from './constants'
import { useMemoryStyles } from './styles'

interface MemorySearchProps {
  query: string
  setQuery: (v: string) => void
  searchMethod: SearchMethod
  setSearchMethod: (v: SearchMethod) => void
  searchLimit: number
  setSearchLimit: (v: number) => void
  useRerank: boolean
  setUseRerank: (v: boolean) => void
  filterTypes: string[]
  setFilterTypes: (v: string[]) => void
  loading: boolean
  onSearch: (overrideQuery?: string) => void
  onRefreshAll: () => void
}

export function MemorySearch({
  query,
  setQuery,
  searchMethod,
  setSearchMethod,
  searchLimit,
  setSearchLimit,
  useRerank,
  setUseRerank,
  filterTypes,
  setFilterTypes,
  loading,
  onSearch,
  onRefreshAll
}: MemorySearchProps) {
  const { styles } = useMemoryStyles()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return (
    <div className={styles.querySection}>
      <div className={styles.queryRow}>
        <Input
          className={styles.queryInput}
          placeholder="输入关键词或描述进行记忆查询（留空则列出全部）"
          value={query}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = setTimeout(() => {
              if (v.trim()) onSearch(v)
            }, 300)
          }}
          onPressEnter={() => onSearch()}
          allowClear
        />
        <Button
          type="primary"
          icon={<Search size={14} />}
          loading={loading}
          onClick={() => onSearch()}
        >
          查询
        </Button>
        <Button onClick={onRefreshAll} loading={loading}>
          刷新全部
        </Button>
      </div>
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'advanced',
            label: '高级选项',
            children: (
              <div className={styles.advancedRow}>
                <span className={styles.advancedLabel}>检索方式</span>
                <Select<SearchMethod>
                  size="small"
                  value={searchMethod}
                  onChange={setSearchMethod}
                  style={{ width: 120 }}
                  options={[
                    { value: 'keyword', label: '关键词' },
                    { value: 'vector', label: '向量' },
                    { value: 'hybrid', label: '混合(默认)' },
                    { value: 'rrf', label: 'RRF' },
                    { value: 'agentic', label: 'Agentic' }
                  ]}
                />
                <span className={styles.advancedLabel}>条数</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={100}
                  value={searchLimit}
                  onChange={(v) => v != null && setSearchLimit(v)}
                  style={{ width: 72 }}
                />
                <Checkbox checked={useRerank} onChange={(e) => setUseRerank(e.target.checked)}>
                  精排
                </Checkbox>
                <span className={styles.advancedLabel}>类型</span>
                <Select
                  size="small"
                  mode="multiple"
                  value={filterTypes}
                  onChange={(v) => setFilterTypes(v)}
                  style={{ minWidth: 160, flex: 1 }}
                  placeholder="全部类型"
                  allowClear
                  maxTagCount={2}
                  options={MEMORY_TYPE_OPTIONS}
                />
              </div>
            )
          }
        ]}
      />
    </div>
  )
}
