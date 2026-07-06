import { useEffect, useState } from 'react'
import { Empty, Input, Space, Table, Tag, type TableColumnsType } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { packagesApi } from '@/api/materialPackages'
import {
  PACKAGE_STATUS_LABELS,
  PACKAGE_STATUS_COLORS,
  TYPE_LABELS,
  type MaterialPackageListItem,
  type MaterialType,
  type PackageStatus,
} from '@/types/domain'
import { colors } from '@/styles/theme'

export interface PackagePickerProps {
  type?: MaterialType
  selectedId: number | null
  onChange: (id: number | null) => void
}

export default function PackagePicker({ type, selectedId, onChange }: PackagePickerProps) {
  const [items, setItems] = useState<MaterialPackageListItem[]>([])
  const [loading, setLoading] = useState(false)

  const fetchPackages = async (query: string) => {
    setLoading(true)
    try {
      const data = await packagesApi.list({
        size: 100,
        status: 'draft' as PackageStatus,
        ...(type ? { material_type: type } : {}),
        ...(query ? { q: query } : {}),
      })
      setItems(data.items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPackages('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const columns: TableColumnsType<MaterialPackageListItem> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    {
      title: '素材数',
      dataIndex: 'item_count',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: PackageStatus) => (
        <Tag color={PACKAGE_STATUS_COLORS[v]}>{PACKAGE_STATUS_LABELS[v]}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
  ]

  const rowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedId ? [selectedId] : [],
    onChange: (keys: React.Key[]) => {
      onChange(keys.length > 0 ? (keys[0] as number) : null)
    },
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Input
          allowClear
          placeholder="搜索素材包名称"
          prefix={<SearchOutlined />}
          style={{ width: 320 }}
          onPressEnter={(e) => fetchPackages((e.target as HTMLInputElement).value)}
          onBlur={(e) => fetchPackages(e.target.value)}
        />
        <span
          style={{
            color: colors.secondary,
            fontSize: 12,
          }}
        >
          {type ? `仅展示 ${TYPE_LABELS[type]} 类型的草稿素材包` : '展示所有草稿状态的素材包'}
        </span>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={rowSelection}
        pagination={{ pageSize: 10, showSizeChanger: false, simple: true }}
        size="small"
        locale={{ emptyText: <Empty description="暂无可选素材包" /> }}
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
