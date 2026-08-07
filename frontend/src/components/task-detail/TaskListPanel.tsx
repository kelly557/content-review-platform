import { useEffect, useState } from 'react'
import { Badge, List, Pagination, Spin, Tag, Tooltip, Typography } from 'antd'
import { reviewsApi } from '@/api/reviews'
import {
  DECISION_LABELS,
  type AgentReviewResult,
  type AgentRiskLevel,
  type ReviewTask,
  type ReviewType,
} from '@/types/domain'
import { RISK_COLOR, truncate } from '@/lib/risk'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  currentTaskId?: number
  onSelect: (taskId: number) => void
}

const PAGE_SIZE = 20

const QUOTE_TRUNCATE = 60

const RISK_BG: Record<string, string> = {
  高风险: colors.dangerSoft,
  中风险: colors.warningSoft,
  低风险: colors.successSoft,
  无风险: colors.surface2,
  敏感: colors.accentSoft,
}

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

  useEffect(() => {
    setLoading(true)
    reviewsApi
      .myTasks({ page, size: PAGE_SIZE, pending: true, scope: 'mine' })
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .finally(() => setLoading(false))
  }, [page])

  const renderRiskChip = (review: AgentReviewResult | null | undefined) => {
    if (!review) {
      return (
        <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
          待审核
        </Tag>
      )
    }
    const level: AgentRiskLevel = review.risk_level
    return (
      <Tag
        style={{
          margin: 0,
          fontSize: 11,
          background: RISK_BG[level] ?? colors.surface2,
          borderColor: RISK_COLOR[level],
          color: RISK_COLOR[level],
        }}
      >
        {level}
      </Tag>
    )
  }

  const renderReviewTypeChip = (reviewType: ReviewType) => (
    <Tag
      color={reviewType === 'machine' ? 'blue' : 'orange'}
      style={{ margin: 0, fontSize: 11 }}
    >
      {reviewType === 'machine' ? '机审' : '人审'}
    </Tag>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: colors.surface,
        }}
      >
        <Text strong>审核任务</Text>
        <Badge
          count={total}
          showZero
          color={colors.accent}
          overflowCount={99}
        />
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
                    padding: '8px 12px',
                    borderBottom: `1px solid ${colors.divider}`,
                    borderLeft: active
                      ? `3px solid ${colors.accent}`
                      : '3px solid transparent',
                    background: active ? colors.accentSoft : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontWeight: active ? 600 : 500,
                      fontSize: 13,
                      color: colors.primary,
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.title}
                  >
                    {t.title}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      flexWrap: 'wrap',
                    }}
                  >
                    {renderRiskChip(review)}
                    {renderReviewTypeChip(t.review_type)}
                    {uniqueLabels.slice(0, 1).map((label) => (
                      <Tag
                        key={label}
                        color="red"
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {label}
                      </Tag>
                    ))}
                    <Tag
                      color={t.final_decision === 'pending' ? 'processing' : 'default'}
                      style={{ margin: 0, fontSize: 11 }}
                    >
                      {DECISION_LABELS[t.final_decision]}
                    </Tag>
                  </div>

                  {firstQuote && (
                    <Tooltip title={firstQuote} placement="topLeft">
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: colors.textSecondary,
                          borderLeft: `3px solid ${colors.destructive}`,
                          paddingLeft: 6,
                          background: colors.dangerSoft,
                          padding: '2px 6px',
                          lineHeight: 1.5,
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 6,
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
                          <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>
                            {(firstScore * 100).toFixed(0)}%
                          </Text>
                        )}
                      </div>
                    </Tooltip>
                  )}
                </div>
              )
            }}
          />
        </Spin>
      </div>

      {total > PAGE_SIZE && (
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            padding: '8px 12px',
            textAlign: 'center',
          }}
        >
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
