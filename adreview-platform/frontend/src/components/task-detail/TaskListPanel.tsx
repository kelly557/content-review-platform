import { useEffect, useState } from 'react'
import { Badge, List, Pagination, Radio, Spin, Tag, Tooltip, Typography } from 'antd'
import { reviewsApi } from '@/api/reviews'
import {
  DECISION_LABELS,
  TYPE_LABELS,
  type AgentReviewResult,
  type AgentRiskLevel,
  type ReviewTask,
  type ReviewType,
} from '@/types/domain'
import { RISK_COLOR, truncate } from '@/lib/risk'

const { Text } = Typography

interface Props {
  currentTaskId?: number
  onSelect: (taskId: number) => void
}

const PAGE_SIZE = 20

type FilterMode = 'pending' | 'machine' | 'human' | 'completed'

const MAX_VISIBLE_TAGS = 3
const QUOTE_TRUNCATE = 60

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of arr) {
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

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

  const renderRiskLevelTag = (review: AgentReviewResult | null | undefined) => {
    if (!review) {
      return <Tag color="default" style={{ margin: 0 }}>待审核</Tag>
    }
    const level: AgentRiskLevel = review.risk_level
    return (
      <Tag color={RISK_COLOR[level]} style={{ margin: 0 }}>
        {level}
      </Tag>
    )
  }

  const renderReviewTypeTag = (reviewType: ReviewType) => {
    if (reviewType === 'machine') {
      return <Tag color="blue" style={{ margin: 0 }}>机审</Tag>
    }
    return <Tag color="orange" style={{ margin: 0 }}>人审</Tag>
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
              const review = t.agent_review ?? null
              const hits = review?.hits ?? []
              const uniqueLabels = dedupe(hits.map((h) => h.label_cn))
              const firstQuoteHit = hits.find((h) => h.quote)
              const firstQuote = firstQuoteHit?.quote ?? null
              const firstScore = firstQuoteHit?.score ?? null
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {renderRiskLevelTag(review)}
                    {renderReviewTypeTag(t.review_type)}
                    {t.material_type && (
                      <Tag style={{ margin: 0 }}>{TYPE_LABELS[t.material_type]}</Tag>
                    )}
                    <Tag
                      color={t.final_decision === 'pending' ? 'processing' : 'default'}
                      style={{ margin: 0 }}
                    >
                      {DECISION_LABELS[t.final_decision]}
                    </Tag>
                  </div>

                  {uniqueLabels.length > 0 && (
                    <div
                      style={{
                        marginTop: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        flexWrap: 'wrap',
                      }}
                    >
                      {uniqueLabels.slice(0, MAX_VISIBLE_TAGS).map((label) => (
                        <Tag key={label} color="red" style={{ margin: 0, fontSize: 11 }}>
                          {label}
                        </Tag>
                      ))}
                      {uniqueLabels.length > MAX_VISIBLE_TAGS && (
                        <Tag style={{ margin: 0, fontSize: 11 }}>
                          +{uniqueLabels.length - MAX_VISIBLE_TAGS}
                        </Tag>
                      )}
                    </div>
                  )}

                  {firstQuote && (
                    <Tooltip title={firstQuote} placement="topLeft">
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: '#475569',
                          borderLeft: '3px solid #DC2626',
                          paddingLeft: 8,
                          background: '#FEF2F2',
                          padding: '4px 8px',
                          lineHeight: 1.5,
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          “{truncate(firstQuote, QUOTE_TRUNCATE)}”
                        </span>
                        {firstScore !== null && (
                          <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                            {(firstScore * 100).toFixed(0)}%
                          </Text>
                        )}
                      </div>
                    </Tooltip>
                  )}

                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: '#94A3B8',
                      textAlign: 'right',
                    }}
                  >
                    {new Date(t.created_at).toLocaleString('zh-CN')}
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