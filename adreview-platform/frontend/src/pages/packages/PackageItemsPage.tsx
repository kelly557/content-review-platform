import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import { servicesApi } from '@/api/services'
import type { AuditItem, Service } from '@/types/domain'
import { useAuthStore } from '@/store'

export default function PackageItemsPage() {
  const { code = '' } = useParams<{ code: string }>()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [pkg, setPkg] = useState<Service | null>(null)
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await auditItemsApi.list(code, {
        q: q || undefined,
        enabled:
          enabledFilter === 'all' ? undefined : enabledFilter === 'enabled',
      })
      setItems(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!code) return
    void (async () => {
      const data = await servicesApi.list({ size: 200, q: code })
      setPkg(data.items.find((s) => s.code === code) ?? null)
    })()
    void fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => {
    void fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, enabledFilter])

  const toggleEnabled = async (item: AuditItem) => {
    await auditItemsApi.update(code, item.id, { is_enabled: !item.is_enabled })
    message.success(item.is_enabled ? '已禁用' : '已启用')
    void fetch()
  }

  const removeItem = async (item: AuditItem) => {
    try {
      await auditItemsApi.remove(code, item.id)
      message.success('已删除')
      void fetch()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const columns: ColumnsType<AuditItem> = [
    {
      title: '审核项',
      dataIndex: 'name_cn',
      width: '20%',
      render: (v, row) => (
        <Space size={6}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          <Tag>{row.code}</Tag>
        </Space>
      ),
    },
    {
      title: '别名',
      dataIndex: 'aliases',
      width: '24%',
      render: (v: string[]) =>
        v && v.length > 0 ? (
          <Space size={4} wrap>
            {v.map((a) => (
              <Tag key={a} color="default">
                {a}
              </Tag>
            ))}
          </Space>
        ) : (
          <span style={{ color: '#94A3B8' }}>—</span>
        ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: '24%',
      render: (v) => v ?? <span style={{ color: '#94A3B8' }}>—</span>,
    },
    {
      title: '审核点数',
      dataIndex: 'point_count',
      width: '10%',
      align: 'center',
      render: (v: number) => <Tag color={v > 0 ? 'blue' : 'default'}>{v}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'is_enabled',
      width: '8%',
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.is_enabled}
          disabled={!isAdmin}
          onChange={() => toggleEnabled(row)}
        />
      ),
    },
    {
      title: '操作',
      width: '14%',
      render: (_, row) => (
        <Space size={4}>
          <Link to={`/packages/${code}/items/${row.id}/points`}>审核点</Link>
          {isAdmin && (
            <Popconfirm title="确认删除该审核项？" onConfirm={() => removeItem(row)}>
              <a style={{ color: '#ef4444' }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 16,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Space size={8} align="center" wrap>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{pkg?.name ?? code}</span>
          <Tag color="blue">规则包</Tag>
          <Tag>{items.length} 个审核项</Tag>
        </Space>
        {isAdmin && (
          <Space>
            <Link to={`/packages/${code}/items/new`}>
              <Button icon={<ThunderboltOutlined />}>自然语言新建</Button>
            </Link>
            <Link to={`/packages/${code}/items/new?mode=form`}>
              <Button type="primary" icon={<PlusOutlined />}>
                新建审核项
              </Button>
            </Link>
          </Space>
        )}
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="搜索审核项名称"
          style={{ width: 240 }}
          onSearch={setQ}
        />
        <Select
          value={enabledFilter}
          onChange={(v) => setEnabledFilter(v)}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'enabled', label: '已启用' },
            { value: 'disabled', label: '已禁用' },
          ]}
        />
      </Space>

      <Table<AuditItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={q ? '无匹配审核项' : '该规则包暂无审核项'}
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
    </div>
  )
}