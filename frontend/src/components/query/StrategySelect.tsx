import { useEffect, useMemo, useState } from 'react'
import { Select, Spin } from 'antd'
import { queryApi } from '@/api/query'

interface StrategyOption {
  value: string
  label: string
}

interface Props {
  value?: string
  onChange?: (v: string | undefined) => void
  placeholder?: string
  allowClear?: boolean
}

export default function StrategySelect({
  value,
  onChange,
  placeholder = '请选择审核策略',
  allowClear = true,
}: Props) {
  const [options, setOptions] = useState<StrategyOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    queryApi
      .strategies()
      .then((items) => {
        if (!alive) return
        setOptions(
          items.map((s) => ({
            value: s.code,
            label: s.name || s.code,
          })),
        )
      })
      .catch(() => {
        if (!alive) return
        setOptions([])
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const merged = useMemo(() => {
    if (!value) return options
    if (options.find((o) => o.value === value)) return options
    return [{ value, label: value }, ...options]
  }, [options, value])

  return (
    <Select
      value={value}
      onChange={(v) => onChange?.(v as string | undefined)}
      options={merged}
      placeholder={placeholder}
      allowClear={allowClear}
      showSearch
      optionFilterProp="label"
      loading={loading}
      notFoundContent={loading ? <Spin size="small" /> : '暂无策略'}
      style={{ width: '100%' }}
    />
  )
}