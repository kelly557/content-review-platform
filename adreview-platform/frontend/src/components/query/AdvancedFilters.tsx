import { Button, Flex, Select, Space } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { AdvancedCondition } from '@/types/domain'

interface Props {
  value: AdvancedCondition[]
  onChange: (next: AdvancedCondition[]) => void
  labelOptions: string[]
}

const OP_OPTIONS = [
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不含' },
]

export default function AdvancedFilters({ value, onChange, labelOptions }: Props) {
  const rows = value.length ? value : [{ op: 'contains' as const, value: '' }]

  const updateRow = (idx: number, patch: Partial<AdvancedCondition>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    onChange(next.filter((r) => r.value.trim().length > 0))
  }

  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx)
    onChange(next.filter((r) => r.value.trim().length > 0))
  }

  const addRow = () => {
    if (rows.length >= 5) return
    onChange([...rows, { op: 'contains', value: '' }])
  }

  return (
    <div
      style={{
        padding: 12,
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        borderRadius: 6,
      }}
    >
      <Flex vertical gap="small" style={{ width: '100%' }}>
        {rows.map((row, idx) => (
          <Flex key={idx} gap="small" wrap="wrap" align="center">
            <span style={{ fontSize: 12, color: '#64748B', minWidth: 64 }}>条件查询</span>
            <Select
              value={row.op}
              onChange={(v) => updateRow(idx, { op: v })}
              options={OP_OPTIONS}
              style={{ width: 110 }}
            />
            <Select
              mode="tags"
              value={row.value ? [row.value] : []}
              onChange={(vs: string[]) => updateRow(idx, { value: vs[0] ?? '' })}
              options={labelOptions.map((l) => ({ value: l, label: l }))}
              placeholder="选择或输入关键词"
              style={{ flex: 1, minWidth: 220 }}
              maxTagCount="responsive"
            />
            <Button
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => removeRow(idx)}
              aria-label="删除条件"
              disabled={rows.length === 1 && !row.value}
            />
          </Flex>
        ))}
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={addRow}
            disabled={rows.length >= 5}
            size="small"
          >
            添加条件
          </Button>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>最多 5 个条件</span>
        </Space>
      </Flex>
    </div>
  )
}