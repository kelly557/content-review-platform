import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button,
  Empty,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined } from '@ant-design/icons'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint, AuditPointRisk } from '@/types/domain'
import { useAuthStore } from '@/store'
import { canManageBackend } from '@/lib/permissions'

const { Text } = Typography

const RISK_COLORS: Record<AuditPointRisk, string> = {
  低风险: 'green',
  中风险: 'gold',
  高风险: 'red',
}

export default function AuditPointsPage() {
  const { code = '', itemId = '' } = useParams<{ code: string; itemId: string }>()
  const { user } = useAuthStore()
  const isAdmin = canManageBackend(user)
  const isSuperadmin = user?.role === 'superadmin'

  const [item, setItem] = useState<AuditItem | null>(null)
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const [items, list] = await Promise.all([
        auditItemsApi.list(code),
        auditPointsApi.list(code, { item_id: Number(itemId) }),
      ])
      setItem(items.find((i) => i.id === Number(itemId)) ?? null)
      setPoints(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (code && itemId) void fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, itemId])

  const toggleEnabled = async (p: AuditPoint) => {
    await auditPointsApi.update(code, p.id, { is_enabled: !p.is_enabled })
    void fetch()
  }

  const remove = async (p: AuditPoint) => {
    await auditPointsApi.remove(code, p.id)
    message.success('已删除')
    void fetch()
  }

  const columns: ColumnsType<AuditPoint> = [
    {
      title: '审核点',
      width: '22%',
      render: (_, row) => (
        <Space size={6} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Space size={6}>
            <Text strong>{row.label_cn || row.label}</Text>
            <Tag>{row.code}</Tag>
          </Space>
          {row.description && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '中风险分',
      dataIndex: 'medium_threshold',
      width: '10%',
      align: 'right',
      render: (v: number) => v.toFixed(1),
    },
    {
      title: '高风险分',
      dataIndex: 'high_threshold',
      width: '10%',
      align: 'right',
      render: (v: number) => v.toFixed(1),
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: '10%',
      render: (v: AuditPointRisk) => <Tag color={RISK_COLORS[v]}>{v}</Tag>,
    },
    {
      title: '细分检测范围',
      dataIndex: 'scope_text',
      width: '24%',
      render: (v) =>
        v ?? <span style={{ color: '#94A3B8' }}>—</span>,
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
      width: '16%',
      render: (_, row) => {
        const showSuperadminLabel = row.is_builtin && isSuperadmin
        const showLimitedLabel = row.is_builtin && !isSuperadmin
        return (
          <Space size={4}>
            {showSuperadminLabel ? (
              <Tooltip title="通用审核点:超级管理员可编辑全部字段">
                <Link
                  to={`/packages/${code}/items/${itemId}/points/${row.id}`}
                  style={{ color: '#7C3AED' }}
                >
                  编辑（全部）
                </Link>
              </Tooltip>
            ) : showLimitedLabel ? (
              <Tooltip title="通用审核点:仅允许修改启用 / 中/高风险分 / 关联自定义库">
                <Link
                  to={`/packages/${code}/items/${itemId}/points/${row.id}`}
                  style={{ color: '#94A3B8' }}
                >
                  编辑
                </Link>
              </Tooltip>
            ) : (
              <Link to={`/packages/${code}/items/${itemId}/points/${row.id}`}>
                编辑
              </Link>
            )}
            {isAdmin && (
              <Popconfirm title="确认删除该审核点？" onConfirm={() => remove(row)}>
                <a style={{ color: '#ef4444' }}>删除</a>
              </Popconfirm>
            )}
          </Space>
        )
      },
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
        <Space size={8} wrap>
          <Link to={`/packages/${code}/items`}>
            <Text style={{ color: '#94A3B8' }}>← 返回 {item?.name_cn ?? code}</Text>
          </Link>
          {item && (
            <Tag color="blue" style={{ marginLeft: 8 }}>
              审核项：{item.name_cn}
            </Tag>
          )}
        </Space>
        {isAdmin && (
          <Link to={`/packages/${code}/items/${itemId}/points/new`}>
            <Button type="primary" icon={<PlusOutlined />}>
              新建审核点
            </Button>
          </Link>
        )}
      </div>

      <Table<AuditPoint>
        rowKey="id"
        loading={loading}
        dataSource={points}
        columns={columns}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该审核项下暂无审核点"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
    </div>
  )
}