import { useEffect, useState } from 'react'
import { Badge, List, Pagination, Radio, Spin, Tag, Typography } from 'antd'
import { reviewsApi } from '@/api/reviews'
import { DECISION_LABELS, type ReviewTask, type ReviewType } from '@/types/domain'

const { Text } = Typography

interface Props {
  currentTaskId?: number
  onSelect: (taskId: number) => void
}

const PAGE_SIZE = 20

type FilterMode = 'pending' | 'machine' | 'human' | 'completed'

export default function TaskListPanel({ currentTaskId, onSelect }: Props) {
  const [items, setItems] = useState<ReviewTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('pending')

  useEffect(() => {
    setLoading(true)
    const params: { page: number; size: number; pending?: boolean; scope: 'mine' } = {
      page,
      size: PAGE_SIZE,
      scope: 'mine',
    }

    if (filterMode === 'pending') {
      params.pending = true
    }

    reviewsApi
      .myTasks(params)
      .then((res) => {
        let filtered = res.items
        if (filterMode === 'machine') {
          filtered = res.items.filter((t) => t.review_type === 'machine')
        } else if (filterMode === 'human') {
          filtered = res.items.filter((t) => t.review_type === 'human')
        } else if (filterMode === 'completed') {
          filtered = res.items.filter((t) => t.final_decision !== 'pending')
        }
        setItems(filtered)
        setTotal(filterMode === 'pending' ? res.total : filtered.length)
      })
      .finally(() => setLoading(false))
  }, [page, filterMode])

  const renderReviewTypeTag = (reviewType: ReviewType) => {
    if (reviewType === 'machine') {
      return <Tag color="blue">机审</Tag>
    }
    return <Tag color="orange">人审</Tag>
  }

  const renderMachineStatusTag = (task: ReviewTask) => {
    if (task.review_type !== 'machine' || !task.machine_status) return null
    const statusMap: Record<string, { color: string; label: string }> = {
      pending: { color: 'default', label: '待执行' },
      running: { color: 'processing', label: '执行中' },
      completed: { color: 'success', label: '已完成' },
      failed: { color: 'error', label: '失败' },
    }
    const cfg = statusMap[task.machine_status] || { color: 'default', label: task.machine_status }
    return <Tag color={cfg.color}>{cfg.label}</Tag>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong>审核任务</Text>
          <Badge count={total} showZero color="#0369A1" overflowCount={99} />
        </div>
        <Radio.Group
          value={filterMode}
          onChange={(e) => {
            setFilterMode(e.target.value)
            setPage(1)
          }}
          size="small"
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="pending">待处理</Radio.Button>
          <Radio.Button value="machine">机审</Radio.Button>
          <Radio.Button value="human">人审</Radio.Button>
          <Radio.Button value="completed">已完成</Radio.Button>
        </Radio.Group>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Spin spinning={loading}>
          <List
            dataSource={items}
            locale={{ emptyText: '暂无任务' }}
            renderItem={(t) => {
              const active = t.id === currentTaskId
              return (
                <div
                  onClick={() => onSelect(t.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #F1F5F9',
                    borderLeft: active ? '3px solid #0369A1' : '3px solid transparent',
                    background: active ? '#F0F9FF' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontWeight: active ? 600 : 500,
                      color: '#0F172A',
                      marginBottom: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.title}
                  >
                    {t.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {renderReviewTypeTag(t.review_type)}
                      {renderMachineStatusTag(t)}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleDateString('zh-CN')}
                    </Text>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <Tag color="processing" style={{ margin: 0, fontSize: 11 }}>
                      {DECISION_LABELS[t.final_decision]}
                    </Tag>
                  </div>
                </div>
              )
            }}
          />
        </Spin>
      </div>

      {total > PAGE_SIZE && (
        <div style={{ borderTop: '1px solid #E2E8F0', padding: '8px 12px', textAlign: 'center' }}>
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            size="small"
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      )}
    </div>
  )
}