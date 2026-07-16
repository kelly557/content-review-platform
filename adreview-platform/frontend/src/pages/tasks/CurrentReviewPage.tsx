import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Empty, Input, Space, Table, Tag, type TableColumnsType } from 'antd'
import { PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { reviewsApi } from '@/api/reviews'
import { canCreateTask } from '@/lib/permissions'
import { useAuthStore } from '@/store'
import {
  MACHINE_DECISION_OPTIONS,
  TYPE_LABELS,
  WORKFLOW_MODE_LABELS,
  type MachineDecision,
  type ReviewTask,
  type ReviewDecision,
  type WorkflowMode,
} from '@/types/domain'
import TaskStatusTag from '@/components/task-list/TaskStatusTag'
import TaskSearchBar from '@/components/task-list/TaskSearchBar'
import TaskFilterPanel, { type TaskFilters } from '@/components/task-list/TaskFilterPanel'
import TaskStatusTabs from '@/components/task-list/TaskStatusTabs'
import TaskBulkActions from '@/components/task-list/TaskBulkActions'

export default function CurrentReviewPage() {
  const { message, modal } = App.useApp()
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
    canceled: 0,
  })

  const canCreate = canCreateTask(user)
  const canCancel = (task: ReviewTask) =>
    task.final_decision === 'pending' &&
    task.canceled_at == null &&
    (task.machine_status === 'pending' ||
      task.machine_status === 'running' ||
      task.machine_status == null)

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
      const [allRes, pendingRes, approvedRes, rejectedRes, returnedRes, canceledRes] = await Promise.all([
        reviewsApi.myTasks({ scope: 'all', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'pending', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'approved', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'rejected', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'returned', size: 1 }),
        reviewsApi.myTasks({ scope: 'all', status: 'canceled', size: 1 }),
      ])
      setCounts({
        all: allRes.total,
        pending: pendingRes.total,
        approved: approvedRes.total,
        rejected: rejectedRes.total,
        returned: returnedRes.total,
        canceled: canceledRes.total,
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

  const handleCancel = (task: ReviewTask) => {
    let reason = ''
    modal.confirm({
      title: '取消任务',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>确认取消任务「{task.title}」？该操作不可撤销。</p>
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder="请输入取消原因（可选）"
            onChange={(e) => {
              reason = e.target.value
            }}
          />
        </div>
      ),
      okText: '确认取消',
      okButtonProps: { danger: true },
      cancelText: '不取消',
      onOk: async () => {
        try {
          await reviewsApi.cancelTask(task.id, reason || undefined)
          message.success('任务已取消')
          fetchTasks()
          fetchCounts()
        } catch (e) {
          const err = e as { response?: { data?: { detail?: string } }; message?: string }
          message.error(err.response?.data?.detail || err.message || '取消失败')
        }
      },
    })
  }

  const renderWorkflowMode = (mode: WorkflowMode | undefined) => {
    const value: WorkflowMode = mode ?? 'machine_only'
    const isHybrid = value === 'machine_then_human'
    return (
      <Tag color={isHybrid ? 'purple' : 'blue'} style={{ margin: 0 }}>
        {WORKFLOW_MODE_LABELS[value]}
      </Tag>
    )
  }

  const renderAiDecision = (task: ReviewTask) => {
    const decision = (task.machine_result as { suggested_action?: MachineDecision } | null)
      ?.suggested_action
    if (!decision) return <span style={{ color: '#94A3B8' }}>—</span>
    const opt = MACHINE_DECISION_OPTIONS.find((o) => o.value === decision)
    return opt ? <Tag color={opt.color} style={{ margin: 0 }}>{opt.label}</Tag> : decision
  }

  const columns: TableColumnsType<ReviewTask> = [
    {
      title: '任务',
      dataIndex: 'title',
      ellipsis: true,
      render: (text, record) => (
        <a onClick={() => navigate(`/tasks/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '素材类型',
      dataIndex: 'material_type',
      width: 90,
      render: (v) => (v ? <Tag style={{ margin: 0 }}>{TYPE_LABELS[v as keyof typeof TYPE_LABELS]}</Tag> : '—'),
    },
    {
      title: '流程',
      key: 'workflow_mode',
      width: 110,
      hidden: true,
      render: (_, record) => renderWorkflowMode(record.workflow_mode),
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, record) => <TaskStatusTag task={record} />,
    },
    {
      title: 'AI 结论',
      key: 'ai_decision',
      width: 90,
      render: (_, record) => renderAiDecision(record),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/tasks/${record.id}`)}>
            查看
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={!canCancel(record)}
            onClick={() => handleCancel(record)}
          >
            取消
          </Button>
        </Space>
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
        <div style={{ fontSize: 20, fontWeight: 600 }}>现在审核</div>
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
