import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { App, Button, Empty, Space, Table, Tabs, Tag, type TableColumnsType } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { reviewsApi } from '@/api/reviews'
import { useAuthStore } from '@/store'
import { DECISION_LABELS, type ReviewTask } from '@/types/domain'

type Scope = 'all' | 'mine' | 'assigned'

const SCOPE_TABS: { key: Scope; label: string; allow: string[] }[] = [
  { key: 'all', label: '所有任务', allow: ['submitter', 'reviewer', 'mlr', 'admin'] },
  { key: 'mine', label: '我发起的', allow: ['submitter', 'admin'] },
  { key: 'assigned', label: '我处理的', allow: ['reviewer', 'mlr', 'admin'] },
]

export default function TasksPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [params, setParams] = useSearchParams()

  const rawScope = (params.get('tab') as Scope | null) || 'all'
  const visibleTabs = SCOPE_TABS.filter((t) => user && t.allow.includes(user.role))
  const activeScope: Scope = visibleTabs.find((t) => t.key === rawScope)
    ? rawScope
    : (visibleTabs[0]?.key ?? 'all')

  const [items, setItems] = useState<ReviewTask[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pendingFilter, setPendingFilter] = useState<'all' | 'pending' | 'done'>('all')

  const canCreate = user?.role === 'submitter' || user?.role === 'admin'

  const fetch = async () => {
    if (!user) return
    setLoading(true)
    try {
      const pendingParam =
        pendingFilter === 'all' ? undefined : pendingFilter === 'pending'
      const data = await reviewsApi.myTasks({
        scope: activeScope,
        pending: pendingParam,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (e) {
      message.error('加载任务失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScope, pendingFilter])

  const onTabChange = (key: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  const columns: TableColumnsType<ReviewTask> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    {
      title: '任务',
      dataIndex: 'title',
      render: (text, record) => (
        <a onClick={() => navigate(`/tasks/${record.id}`)}>{text}</a>
      ),
    },
    { title: '阶段', dataIndex: 'stage_key', width: 140 },
    {
      title: '素材',
      dataIndex: 'material_id',
      width: 100,
      render: (mid: number, record) => (
        <a onClick={() => navigate(`/materials/${record.material_id}`)}>#{mid}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'final_decision',
      width: 100,
      render: (v: ReviewTask['final_decision']) => (
        <Tag
          color={
            v === 'approved' ? 'success' : v === 'rejected' ? 'error' : v === 'returned' ? 'warning' : 'default'
          }
        >
          {DECISION_LABELS[v]}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 200,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => navigate(`/tasks/${record.id}`)}>
          查看
        </Button>
      ),
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>审核任务</div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetch}>
            刷新
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/new')}>
              创建任务
            </Button>
          )}
        </Space>
      </div>

      <Tabs
        activeKey={activeScope}
        onChange={onTabChange}
        items={visibleTabs.map((t) => ({
          key: t.key,
          label: t.label,
        }))}
        tabBarExtraContent={
          <Space>
            <Button
              size="small"
              type={pendingFilter === 'all' ? 'primary' : 'default'}
              onClick={() => setPendingFilter('all')}
            >
              全部
            </Button>
            <Button
              size="small"
              type={pendingFilter === 'pending' ? 'primary' : 'default'}
              onClick={() => setPendingFilter('pending')}
            >
              待处理
            </Button>
            <Button
              size="small"
              type={pendingFilter === 'done' ? 'primary' : 'default'}
              onClick={() => setPendingFilter('done')}
            >
              已处理
            </Button>
          </Space>
        }
      />

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize: 20, total, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="暂无任务" /> }}
      />
    </div>
  )
}
