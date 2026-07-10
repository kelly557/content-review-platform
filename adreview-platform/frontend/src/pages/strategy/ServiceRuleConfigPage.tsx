import { useEffect, useState } from 'react'
import {
  App,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons'
import { Link, useLocation, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint } from '@/types/domain'

const { Title, Text } = Typography

const PACKAGE_BY_MEDIA: Record<string, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

export default function ServiceRuleConfigPage() {
  const { message } = App.useApp()
  const { mediaType, serviceCode, itemId } = useParams<{
    mediaType?: string
    serviceCode?: string
    itemId?: string
  }>()
  const location = useLocation()

  const nestedPackage =
    mediaType && PACKAGE_BY_MEDIA[mediaType] ? PACKAGE_BY_MEDIA[mediaType] : null
  const code = serviceCode ?? nestedPackage ?? null
  const activeItemId =
    itemId != null && !Number.isNaN(Number(itemId)) ? Number(itemId) : null

  const backState = (location.state ?? {}) as { from?: string; fromStep?: 0 | 1 }
  const backTarget = backState.from ?? `/strategies/rules-by-type/${mediaType ?? 'image'}`
  const backStepState =
    backState.fromStep != null ? { step: backState.fromStep } : undefined
  const backLabel = backState.from ? '返回策略审核规则' : '返回规则列表'

  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [activeItemName, setActiveItemName] = useState<string | null>(null)
  const [activeItemBuiltin, setActiveItemBuiltin] = useState(false)

  useEffect(() => {
    if (!code || activeItemId == null) return
    let cancel = false
    setLoading(true)
    Promise.all([
      auditPointsApi.list(code, { item_id: activeItemId }).catch(() => [] as AuditPoint[]),
      auditItemsApi.list(code).catch(() => [] as AuditItem[]),
    ])
      .then(([ps, items]) => {
        if (cancel) return
        setPoints(ps)
        const found = items.find((it) => it.id === activeItemId)
        setActiveItemName(found?.name_cn ?? null)
        setActiveItemBuiltin(found?.is_builtin ?? false)
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [code, activeItemId])

  const onDeletePoint = async (row: AuditPoint) => {
    if (!code) return
    try {
      await auditPointsApi.remove(code, row.id)
      message.success(`已删除「${row.label_cn || row.code}」`)
      setPoints((prev) => prev.filter((p) => p.id !== row.id))
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail
      message.error(detail ?? '删除失败')
    }
  }

  const columns: ColumnsType<AuditPoint> = [
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: '28%',
      render: (v: string | null, row) => (
        <Space size={6} align="center">
          <span style={{ color: '#020617', fontWeight: 500 }}>
            {v || row.label || row.code}
          </span>
          {row.is_builtin ? (
            <Tag color="gold" style={{ margin: 0 }}>
              通用
            </Tag>
          ) : (
            <Tag color="blue" style={{ margin: 0 }}>
              个性化
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '审核内容',
      dataIndex: 'scope_text',
      render: (v: string | null, row) => (
        <div>
          <Text style={{ color: '#020617' }}>{v ?? '—'}</Text>
          {row.description && (
            <div style={{ marginTop: 4, color: '#64748B', fontSize: 12 }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      width: 100,
      render: (_v, row) =>
        row.is_builtin ? (
          <Text type="secondary">—</Text>
        ) : (
          <Popconfirm
            title={`确认删除「${row.label_cn || row.code}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDeletePoint(row)}
          >
            <a
              style={{ color: '#DC2626' }}
              aria-label={`删除 ${row.label_cn || row.code}`}
            >
              <Space size={4}>
                <DeleteOutlined />
                删除
              </Space>
            </a>
          </Popconfirm>
        ),
    },
  ]

  if (!code) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该审核类型暂无规则包"
        style={{ padding: '40px 0' }}
      />
    )
  }

  return (
    <div className="service-rule-page">
      <Space style={{ marginBottom: 12 }} align="center">
        <Link to={backTarget} state={backStepState} style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            {backLabel}
          </Space>
        </Link>
      </Space>

      <Space
        size={12}
        align="center"
        style={{ marginBottom: 16, flexWrap: 'wrap' }}
      >
        <Title level={3} style={{ margin: 0 }}>
          审核范围配置
        </Title>
        {activeItemName && (
          <Text type="secondary" style={{ fontSize: 14 }}>
            · {activeItemName}
          </Text>
        )}
        {activeItemBuiltin ? (
          <Tooltip title="通用规则由平台预置，仅可删除/查阅；启用 / 风险分 / 关联自定义库请到「创建策略」按需配置">
            <Tag
              color="gold"
              icon={<LockOutlined />}
              style={{ margin: 0 }}
            >
              通用规则
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="个性化规则可在此删除">
            <Tag
              color="blue"
              icon={<UnlockOutlined />}
              style={{ margin: 0 }}
            >
              个性化规则
            </Tag>
          </Tooltip>
        )}
      </Space>

      <div style={{ marginBottom: 12 }}>
        <Text strong>审核点列表</Text>
      </div>

      <Table<AuditPoint>
        rowKey="id"
        loading={loading}
        dataSource={points}
        columns={columns}
        pagination={false}
        locale={{
          emptyText:
            activeItemId != null ? '该审核项下暂无审核点' : '暂无规则',
        }}
      />
    </div>
  )
}