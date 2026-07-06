import { useEffect, useState } from 'react'
import { Empty, Input, Space, Table, Tag, type TableColumnsType } from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import { SearchOutlined } from '@ant-design/icons'
import { materialsApi } from '@/api/materials'
import { STATUS_LABELS, TYPE_LABELS, type MaterialListItem, type MaterialType } from '@/types/domain'
import { colors } from '@/styles/theme'

export interface MaterialPickerProps {
  type: MaterialType
  selectedIds: number[]
  onChange: (ids: number[]) => void
  maxCount?: number
}

export default function MaterialPicker({ type, selectedIds, onChange, maxCount = 50 }: MaterialPickerProps) {
  const [items, setItems] = useState<MaterialListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchPage = async (query: string) => {
    setLoading(true)
    try {
      const [drafts, rejected] = await Promise.all([
        materialsApi.list({ size: 100, status: 'draft', material_type: type, ...(query ? { q: query } : {}) }),
        materialsApi.list({ size: 100, status: 'rejected', material_type: type, ...(query ? { q: query } : {}) }),
      ])
      const map = new Map<number, MaterialListItem>()
      ;[...drafts.items, ...rejected.items].forEach((m) => map.set(m.id, m))
      setItems(Array.from(map.values()))
      setTotal(map.size)
    } catch {
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPage('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const columns: TableColumnsType<MaterialListItem> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v) => <Tag color={v === 'draft' ? 'default' : 'error'}>{STATUS_LABELS[v as keyof typeof STATUS_LABELS]}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ]

  const rowSelection: TableRowSelection<MaterialListItem> = {
    selectedRowKeys: selectedIds,
    onChange: (keys) => onChange((keys as number[]).slice(0, maxCount)),
    preserveSelectedRowKeys: true,
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Input
          allowClear
          placeholder="搜索标题或描述"
          prefix={<SearchOutlined />}
          style={{ width: 320 }}
          onPressEnter={(e) => fetchPage((e.target as HTMLInputElement).value)}
          onBlur={(e) => fetchPage(e.target.value)}
        />
        <span
          style={{
            color: colors.secondary,
            fontSize: 12,
          }}
        >
          已选 {selectedIds.length} / {maxCount} · 仅展示 {TYPE_LABELS[type]} 类型的草稿/已驳回素材
        </span>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={rowSelection}
        pagination={{ pageSize: 10, total, showSizeChanger: false, simple: true }}
        size="small"
        locale={{ emptyText: <Empty description="暂无可选素材" /> }}
        scroll={{ y: 360 }}
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
