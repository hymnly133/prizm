/**
 * TagSelector - 标签选择/创建组件
 * 基于 Ant Design Select，支持多选、创建新标签
 */
import { Select } from 'antd'
import { useMemo } from 'react'

interface TagSelectorProps {
  value?: string[]
  onChange?: (tags: string[]) => void
  /** 可选的标签建议列表 */
  suggestions?: string[]
  placeholder?: string
  disabled?: boolean
  maxTagCount?: number
}

export default function TagSelector({
  value = [],
  onChange,
  suggestions = [],
  placeholder = '添加标签...',
  disabled = false,
  maxTagCount = 10
}: TagSelectorProps) {
  const options = useMemo(() => {
    const allTags = new Set([...suggestions, ...value])
    return Array.from(allTags).map((tag) => ({
      label: tag,
      value: tag
    }))
  }, [suggestions, value])

  return (
    <Select
      mode="tags"
      value={value}
      onChange={(val) => onChange?.(val)}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      maxTagCount={maxTagCount}
      tokenSeparators={[',', '，', ' ']}
      size="small"
      style={{ width: '100%' }}
      allowClear
    />
  )
}
