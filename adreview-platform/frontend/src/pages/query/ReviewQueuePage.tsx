import { useCallback, useEffect, useState } from 'react'
import { App, Button, Empty, Flex, Input, Pagination, Select, Space, Typography } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { queryApi } from '@/api/query'
import {
  DETECTION_MODALITIES,
  FEEDBACK_OPTIONS,
  type DetectionModality,
  type MachineReviewRecord,
  type ReviewDecision,
  type ReviewFilters,
  type ReviewRecord,
} from '@/types/domain'
import StrategySelect from '@/components/query/StrategySelect'
import ReviewCard from '@/components/query/ReviewCard'
import RecordDetailDrawer from '@/components/query/RecordDetailDrawer'

const REVIEW_TYPE_OPTIONS = [
  { value: 'human', label: '人审' },
  { value: 'machine', label: '机审' },
]

const { Text } = Typography

export default function ReviewQueuePage() {
  const { message } = App.useApp()

  const [filters, setFilters] = useState<ReviewFilters>({ review_type: 'human' })
  const [submitted, setSubmitted] = useState<ReviewFilters>({ review_type: 'human' })

  const [items, setItems] = useState<ReviewRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [detailRecord, setDetailRecord] = useState<MachineReviewRecord | ReviewRecord | null>(
    null,
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await queryApi.review({ ...submitted, page, size })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      message.error('加载复审队列失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [submitted, page, size, message])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const onSearch = () => {
    setPage(1)
    setSubmitted({ ...filters })
  }
  const onReset = () => {
    const fresh: ReviewFilters = { review_type: 'human' }
    setFilters(fresh)
    setSubmitted(fresh)
    setPage(1)
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
        <div style={{ fontSize: 20, fontWeight: 600 }}>复审队列</div>
      </div>

      <Flex gap="middle" wrap="wrap" style={{ width: '100%', marginBottom: 12 }}>
        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>审核类型</div>
          <Select
            value={filters.review_type ?? 'human'}
            onChange={(v) => setFilters((f) => ({ ...f, review_type: v as 'human' | 'machine' }))}
            options={REVIEW_TYPE_OPTIONS}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>违规类型</div>
          <Select<DetectionModality | undefined>
            value={filters.material_type}
            onChange={(v) => setFilters((f) => ({ ...f, material_type: v }))}
            options={[
              { value: undefined as unknown as DetectionModality, label: '全部' },
              ...DETECTION_MODALITIES,
            ]}
            placeholder="全部"
            allowClear
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>服务 Service</div>
          <StrategySelect
            value={filters.strategy_code}
            onChange={(v) => setFilters((f) => ({ ...f, strategy_code: v }))}
          />
        </div>

        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>TaskId</div>
          <Input
            type="number"
            value={filters.task_id ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                task_id: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
            placeholder="请输入"
            allowClear
          />
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>机审RequestId</div>
          <Input
            value={filters.machine_request_id ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, machine_request_id: e.target.value || undefined }))
            }
            placeholder="请输入"
            allowClear
          />
        </div>

        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>DataId</div>
          <Input
            value={filters.data_id ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, data_id: e.target.value || undefined }))}
            placeholder="请输入"
            allowClear
          />
        </div>

        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div style={{ marginBottom: 4, fontSize: 12, color: '#64748B' }}>人审结果</div>
          <Select<ReviewDecision | undefined>
            value={filters.final_decision}
            onChange={(v) => setFilters((f) => ({ ...f, final_decision: v }))}
            options={[
              { value: undefined as unknown as ReviewDecision, label: '全部' },
              ...FEEDBACK_OPTIONS,
            ]}
            placeholder="全部"
            allowClear
            style={{ width: '100%' }}
          />
        </div>
      </Flex>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
          搜索
        </Button>
        <Button onClick={onReset}>重置</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>
          刷新
        </Button>
      </Space>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Text type="secondary">加载中…</Text>
        </div>
      ) : items.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 'clamp(12px, 2vw, 20px)',
          }}
        >
          {items.map((r) => (
            <ReviewCard
              key={r.id}
              record={r}
              onOpenDetail={(rec) => setDetailRecord(rec)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Pagination
          current={page}
          pageSize={size}
          total={total}
          showSizeChanger
          showTotal={(t) => `共 ${t} 条`}
          onChange={(p, s) => {
            setPage(p)
            setSize(s)
          }}
        />
      </div>

      <RecordDetailDrawer record={detailRecord} onClose={() => setDetailRecord(null)} />
    </div>
  )
}