import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Empty, Space, Table, Tag, type TableColumnsType } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { reviewsApi } from '@/api/reviews'
import { useAuthStore } from '@/store'
import { TYPE_LABELS, type ReviewTask, type ReviewDecision } from '@/types/domain'
import TaskStatusTag from '@/components/task-list/TaskStatusTag'
import TaskSearchBar from '@/components/task-list/TaskSearchBar'
import TaskFilterPanel, { type TaskFilters } from '@/components/task-list/TaskFilterPanel'
import TaskStatusTabs from '@/components/task-list/TaskStatusTabs'
import TaskBulkActions from '@/components/task-list/TaskBulkActions'

export default function TasksPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [items, setItems] = useState<ReviewTask[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const [searchQuery, setSearchQuery] = useState('')
  const [filterVisible, setFilterVisible] = useState(false)
  const [filters, setFilters] = useState<TaskFilters>({})
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [counts, setCounts] = useState({
    all: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    returned: 0,
  })

  const canCreate = user?.role === 'submitter' || user?.role === 'admin'

  const fetchTasks = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await reviewsApi.myTasks({
        scope: 'all',
        q: searchQuery || undefined,
        material_type: filters.material_type,
        review_type: filters.review_type,
        status: statusFilter !== 'all' ? (statusFilter as ReviewDecision) : undefined,
        sort_by: filters.sort_by,
        sort_order: filters.sort_order,
        created_after: filters.created_after,
        created_before: filters.created_before,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      message.error('加载任务失败')
    } finally {
      setLoading(false)
    }
  }, [user, searchQuery, filters, statusFilter, message])

  const fetchCounts = useCallback(async () => {
    if (!user) return
    try {
      const [allRes, pendingRes, approvedRes, rejectedRes, returnedRes] = await Promise.all([
        reviewsApi.myTasks({ scope: 'all', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'pending', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'approved', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'rejected', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'returned', size: 1 }),
      ])
      setCounts({
        all: allRes.total,
        pending: pendingRes.total,
        approved: approvedRes.total,
        rejected: rejectedRes.total,
        returned: returnedRes.total,
      })
    } catch {
      // ignore
    }
  }, [user])

  useEffect(() => {
    fetchTasks()
    fetchCounts()
  }, [fetchTasks, fetchCounts])

  const handleSearch = () => {
    fetchTasks()
  }

  const handleFilterChange = (newFilters: TaskFilters) => {
    setFilters(newFilters)
  }

  const handleStatusFilterChange = (key: string) => {
    setStatusFilter(key)
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
    {
      title: '素材类型',
      dataIndex: 'material_type',
      width: 100,
      render: (v) => (v ? <Tag>{TYPE_LABELS[v as keyof typeof TYPE_LABELS]}</Tag> : '-'),
    },
    {
      title: '审核类型',
      dataIndex: 'review_type',
      width: 100,
      render: (v) => <Tag color={v === 'machine' ? 'cyan' : 'orange'}>{v === 'machine' ? '机审' : '人审'}</Tag>,
    },
    { title: '阶段', dataIndex: 'stage_key', width: 140 },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => <TaskStatusTag task={record} />,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
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

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  }

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
          <Button icon={<ReloadOutlined />} onClick={() => { fetchTasks(); fetchCounts() }}>
            刷新
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/new')}>
              创建任务
            </Button>
          )}
        </Space>
      </div>

      <TaskSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        onSearch={handleSearch}
        onToggleFilter={() => setFilterVisible(!filterVisible)}
        filterVisible={filterVisible}
      />

      <TaskFilterPanel
        filters={filters}
        onChange={handleFilterChange}
        visible={filterVisible}
      />

      <TaskStatusTabs
        activeKey={statusFilter}
        onChange={handleStatusFilterChange}
        counts={counts}
      />

      <TaskBulkActions
        selectedTaskIds={selectedRowKeys as number[]}
        onClearSelection={() => setSelectedRowKeys([])}
        onComplete={() => { fetchTasks(); fetchCounts() }}
      />

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        rowSelection={rowSelection}
        pagination={{ pageSize: 20, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="暂无任务" /> }}
      />
    </div>
  )
}
