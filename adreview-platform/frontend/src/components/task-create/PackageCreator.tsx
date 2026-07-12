import { useEffect, useState } from 'react'
import { Button, Empty, Input, Select, Space, Table, Tag, type TableColumnsType } from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { materialsApi } from '@/api/materials'
import { STATUS_LABELS, TYPE_LABELS, type MaterialListItem, type MaterialType } from '@/types/domain'
import { colors } from '@/styles/theme'

const { TextArea } = Input

export interface PackageCreatorProps {
  packageName: string
  onPackageNameChange: (v: string) => void
  packageDescription: string
  onPackageDescriptionChange: (v: string) => void
  packageType: MaterialType
  onPackageTypeChange: (v: MaterialType) => void
  selectedMaterialIds: number[]
  onSelectedMaterialIdsChange: (ids: number[]) => void
  maxCount?: number
}

const TYPE_OPTIONS: { value: MaterialType; label: string }[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'pdf', label: '文档' },
  { value: 'text', label: '文本' },
]

export default function PackageCreator({
  packageName,
  onPackageNameChange,
  packageDescription,
  onPackageDescriptionChange,
  packageType,
  onPackageTypeChange,
  selectedMaterialIds,
  onSelectedMaterialIdsChange,
  maxCount = 50,
}: PackageCreatorProps) {
  const [items, setItems] = useState<MaterialListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const fetchPage = async (query: string, type: MaterialType) => {
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
    fetchPage(searchQuery, packageType)
  }, [packageType])

  const handleSearch = () => {
    fetchPage(searchQuery, packageType)
  }

  const handleTypeChange = (v: MaterialType) => {
    onPackageTypeChange(v)
    onSelectedMaterialIdsChange([])
  }

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
    selectedRowKeys: selectedMaterialIds,
    onChange: (keys) => onSelectedMaterialIdsChange((keys as number[]).slice(0, maxCount)),
    preserveSelectedRowKeys: true,
  }

  const selectedItems = items.filter((item) => selectedMaterialIds.includes(item.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.foreground,
            marginBottom: 8,
          }}
        >
          包名称 <span style={{ color: colors.destructive }}>*</span>
        </div>
        <Input
          value={packageName}
          onChange={(e) => onPackageNameChange(e.target.value)}
          placeholder="请输入素材包名称"
          maxLength={255}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.foreground,
            marginBottom: 8,
          }}
        >
          描述
        </div>
        <TextArea
          value={packageDescription}
          onChange={(e) => onPackageDescriptionChange(e.target.value)}
          placeholder="请输入素材包描述（可选）"
          rows={3}
          maxLength={500}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.foreground,
            marginBottom: 8,
          }}
        >
          素材类型 <span style={{ color: colors.destructive }}>*</span>
        </div>
        <Select
          value={packageType}
          onChange={handleTypeChange}
          options={TYPE_OPTIONS}
          style={{ width: 200 }}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.foreground,
            marginBottom: 8,
          }}
        >
          选择素材
        </div>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Input
            allowClear
            placeholder="搜索标题或描述"
            prefix={<SearchOutlined />}
            style={{ width: 320 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            onBlur={handleSearch}
          />
          <span
            style={{
              color: colors.secondary,
              fontSize: 12,
            }}
          >
            已选 {selectedMaterialIds.length} / {maxCount} · 仅展示 {TYPE_LABELS[packageType]} 类型的草稿/已驳回素材
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

      {selectedMaterialIds.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: colors.foreground,
              marginBottom: 8,
            }}
          >
            已选素材 ({selectedMaterialIds.length})
          </div>
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 12,
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {selectedItems.length === 0 ? (
              <Empty description="暂无已选素材" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: colors.muted,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ color: colors.foreground, fontSize: 13 }}>{item.title}</span>
                      <Tag color={item.status === 'draft' ? 'default' : 'error'}>
                        {STATUS_LABELS[item.status as keyof typeof STATUS_LABELS]}
                      </Tag>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        onSelectedMaterialIdsChange(selectedMaterialIds.filter((id) => id !== item.id))
                      }
                      style={{ color: colors.secondary }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
