/**
 * SearchInput - 带 debounce 和加载状态的搜索输入，使用 @lobehub/ui
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { Input } from '@lobehub/ui'
import { Spin } from 'antd'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  onSearch: (query: string) => void
  placeholder?: string
  loading?: boolean
  debounceMs?: number
  className?: string
  value?: string
  onChange?: (value: string) => void
}

export default function SearchInput({
  onSearch,
  placeholder = '搜索...',
  loading = false,
  debounceMs = 300,
  className,
  value: controlledValue,
  onChange: controlledOnChange
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const value = controlledValue ?? internalValue
  const setValue = controlledOnChange ?? setInternalValue

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setValue(val)

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        onSearch(val.trim())
      }, debounceMs)
    },
    [onSearch, debounceMs, setValue]
  )

  const handleClear = useCallback(() => {
    setValue('')
    onSearch('')
  }, [onSearch, setValue])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <Input
      className={className}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      prefix={loading ? <Spin size="small" /> : <Search size={14} style={{ opacity: 0.5 }} />}
      suffix={
        value ? (
          <X size={14} style={{ opacity: 0.5, cursor: 'pointer' }} onClick={handleClear} />
        ) : null
      }
      size="small"
      allowClear={false}
    />
  )
}
