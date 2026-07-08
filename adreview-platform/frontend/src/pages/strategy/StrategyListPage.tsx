import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Space,
  Tag,
  Input,
  Select,
  Table,
  Tooltip,
  Switch,
  Modal,
  App,
  Empty,
  type TableColumnsType,
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  QuestionCircleOutlined,
  CheckCircleFilled,
  StopOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate, useLocation } from 'react-router-dom'
import { strategiesApi } from '@/api/strategies'
import { useAuthStore } from '@/store'
import {
  type Strategy,
  type StrategyValidateResult,
} from '@/types/domain'

const DEFAULT_TOOLTIP =
  '默认策略在以下任一情况发生时生效执行：未配置策略；所有策略均未启用；所有策略均未达到生效时间。'

const SCOPE_OPTIONS: Array<{ value: 'all' | 'default' | 'general'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'general', label: '通用策略' },
  { value: 'default', label: '默认策略' },
]

function isCurrentlyActive(s: Strategy, now: Dayjs = dayjs()): boolean {
  if (!s.is_active) return false
  if (s.scope === 'default') return true
  if (s.effective_from && now.isBefore(dayjs(s.effective_from))) return false
  if (s.effective_until && !now.isBefore(dayjs(s.effective_until))) return false
  return true
}

function formatRange(s: Strategy): string {
  const from = s.effective_from ? dayjs(s.effective_from).format('YYYY.MM.DD HH:mm') : '—'
  const until = s.effective_until ? dayjs(s.effective_until).format('YYYY.MM.DD HH:mm') : '—'
  return `${from} ~ ${until}`
}

export default function StrategyListPage() {
  const { message } = App.useApp()

  const navigate = useNavigate()
  const location = useLocation()
  const refreshFlag = (location.state as { refresh?: boolean } | null)?.refresh
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [items, setItems] = useState<Strategy[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'all' | 'default' | 'general'>('all')

  const [validateResult, setValidateResult] = useState<{ open: boolean; result?: StrategyValidateResult; name?: string }>({
    open: false,
  })

  const fetch = async () => {
    setLoading(true)
    try {
      const data = await strategiesApi.list({
        page,
        size,
        q: q || undefined,
        scope: scope === 'all' ? undefined : scope,
      })
      setItems(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, scope])

  useEffect(() => {
    if (refreshFlag) {
      fetch()
      window.history.replaceState({}, '', location.pathname + location.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshFlag])

  const onToggleActive = async (s: Strategy, next: boolean) => {
    try {
      await strategiesApi.update(s.id, { is_active: next })
      message.success(next ? '已启用' : '已停用')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '操作失败')
    }
  }

  const onValidate = async (s: Strategy) => {
    try {
      const result = await strategiesApi.validate(s.id)
      setValidateResult({ open: true, result, name: s.name })
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '验证失败')
    }
  }
  void onValidate

  const onDuplicate = async (s: Strategy) => {
    try {
      await strategiesApi.duplicate(s.id)
      message.success('已复制为新策略')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '复制失败')
    }
  }

  const onDelete = async (s: Strategy) => {
    try {
      await strategiesApi.delete(s.id)
      message.success('已删除')
      fetch()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '删除失败')
    }
  }

  const columns: TableColumnsType<Strategy> = useMemo(
    () => [
      {
        title: '策略名称',
        dataIndex: 'name',
        width: '14%',
        render: (text: string, record) =>
          record.scope === 'default' ? (
            <span style={{ color: '#0369A1', fontWeight: 500 }}>{text}</span>
          ) : (
            <span style={{ color: '#0369A1' }}>{text}</span>
          ),
      },
      {
        title: '策略 ID',
        dataIndex: 'code',
        width: '8%',
        render: (v: string) => <span style={{ color: '#64748B' }}>{v}</span>,
      },
      {
        title: '生效状态',
        dataIndex: 'is_active',
        width: '8%',
        render: (_: boolean, record) => {
          const active = isCurrentlyActive(record)
          return active ? (
            <Space size={6}>
              <CheckCircleFilled style={{ color: '#0369A1', fontSize: 12 }} />
              <span style={{ color: '#0F172A' }}>生效中</span>
            </Space>
          ) : (
            <Space size={6}>
              <StopOutlined style={{ color: '#94A3B8', fontSize: 12 }} />
              <span style={{ color: '#64748B' }}>未生效</span>
            </Space>
          )
        },
      },
      {
        title: '生效时段',
        dataIndex: 'effective_from',
        width: '14%',
        render: (_: unknown, record) => {
          if (record.scope === 'default') {
            return (
              <Space size={4}>
                <span style={{ color: '#64748B' }}>满足条件时生效</span>
                <Tooltip title={DEFAULT_TOOLTIP}>
                  <QuestionCircleOutlined style={{ color: '#94A3B8', cursor: 'help' }} />
                </Tooltip>
              </Space>
            )
          }
          if (!record.effective_from && !record.effective_until) {
            return <span style={{ color: '#64748B' }}>长期有效</span>
          }
          return <span style={{ color: '#020617', fontVariantNumeric: 'tabular-nums' }}>{formatRange(record)}</span>
        },
      },
      {
        title: '是否启用',
        dataIndex: 'is_active',
        width: '7%',
        render: (v: boolean, record) => (
          <Switch
            checked={v}
            disabled={!isAdmin || record.scope === 'default'}
            onChange={(next) => onToggleActive(record, next)}
            aria-label={`${record.name} 启用状态`}
          />
        ),
      },
      {
        title: '最近编辑时间',
        dataIndex: 'updated_at',
        width: '11%',
        render: (v: string | null) =>
          v ? (
            <span style={{ color: '#020617' }}>{dayjs(v).format('YYYY.MM.DD HH:mm')}</span>
          ) : (
            <span style={{ color: '#94A3B8' }}>—</span>
          ),
      },
      {
        title: '操作',
        width: '11%',
        fixed: 'right',
        render: (_: unknown, record) => {
          const isDefault = record.scope === 'default'
          if (isDefault || !isAdmin) return null
          return (
            <Space size={12} wrap>
              <a onClick={() => navigate(`/strategies/${record.id}/edit`)}>
                <EditOutlined /> 编辑
              </a>
              <a onClick={() => onDuplicate(record)}>
                <CopyOutlined /> 复制
              </a>
              <a
                style={{ color: '#DC2626' }}
                onClick={() => {
                  Modal.confirm({
                    title: '确认删除该策略？',
                    content: '删除后无法撤销。',
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => onDelete(record),
                  })
                }}
              >
                <DeleteOutlined /> 删除
              </a>
            </Space>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin],
  )

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 'clamp(8px, 1.2vw, 16px)',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Space size={8} align="center" wrap style={{ minWidth: 0 }}>
          <span
            style={{
              fontSize: 'clamp(15px, 1.2vw, 18px)',
              fontWeight: 600,
              color: '#020617',
            }}
          >
            策略管理
          </span>
          <Tag color="blue">共 {total} 条</Tag>
        </Space>
        {isAdmin && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/strategies/new')}
          >
            创建策略
          </Button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 1fr) minmax(160px, auto)',
          gap: 'clamp(8px, 1.2vw, 16px)',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Input
          allowClear
          placeholder="请输入策略名称进行搜索"
          prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
          style={{ width: '100%' }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={() => {
            setPage(1)
            fetch()
          }}
          aria-label="搜索策略"
        />
        <Select
          value={scope}
          onChange={(v) => {
            setScope(v)
            setPage(1)
          }}
          options={SCOPE_OPTIONS}
          style={{ width: '100%' }}
          aria-label="按范围筛选"
        />
      </div>

      <Table<Strategy>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          scroll={{ x: true }}
          pagination={{
            current: page,
            pageSize: size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => {
              setPage(p)
              setSize(s)
            },
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无策略"
                style={{ padding: '24px 0' }}
              >
                {isAdmin && (
                  <Button type="primary" onClick={() => navigate('/strategies/new')}>
                    创建第一条策略
                  </Button>
                )}
              </Empty>
            ),
          }}
          rowClassName={(record) => (record.scope === 'default' ? 'strategy-row-default' : '')}
        />

      <Modal
        title={
          <Space>
            <CheckOutlined style={{ color: '#16A34A' }} />
            验证结果
          </Space>
        }
        open={validateResult.open}
        onCancel={() => setValidateResult({ open: false })}
        footer={
          <Button type="primary" onClick={() => setValidateResult({ open: false })}>
            关闭
          </Button>
        }
      >
        {validateResult.result && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <span style={{ color: '#64748B' }}>策略：</span>
              <strong>{validateResult.name}</strong>
            </div>
            <div>
              {validateResult.result.ok ? (
                <Tag color="success">通过</Tag>
              ) : (
                <Tag color="error">未通过</Tag>
              )}
              <span style={{ color: '#64748B', marginLeft: 8 }}>
                {dayjs(validateResult.result.checked_at).format('YYYY.MM.DD HH:mm:ss')}
              </span>
            </div>
            <div>
              <strong>警告：</strong>
              {validateResult.result.warnings.length === 0 ? (
                <span style={{ color: '#64748B' }}>无</span>
              ) : (
                <ul style={{ margin: '8px 0 0 16px', color: '#D97706' }}>
                  {validateResult.result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </Space>
        )}
      </Modal>

      <style>{`
        .strategy-row-default { background: #F0F9FF !important; }
        .strategy-row-default:hover td { background: #E0F2FE !important; }
      `}</style>
    </div>
  )
}
