import { useEffect, useMemo, useState } from 'react'
import { Badge, List, Pagination, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { reviewsApi } from '@/api/reviews'
import {
  DECISION_LABELS,
  TAG_DOMAIN_OPTIONS,
  TYPE_LABELS,
  type AgentReviewResult,
  type AgentRiskLevel,
  type ReviewTask,
  type ReviewType,
  type TagDomain,
} from '@/types/domain'
import { RISK_COLOR, truncate } from '@/lib/risk'
import { colors } from '@/styles/theme'

const { Text } = Typography
const { CheckableTag } = Tag

interface Props {
  currentTaskId?: number
  onSelect: (taskId: number) => void
}

const PAGE_SIZE = 20

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

/**
 * Heuristic mapping from a mock-detection hit to a tag domain.
 * The backend's `DetectionRule.label_cn` (e.g. "医疗广告违规") carries
 * domain semantics; we map via simple keyword scan.
 */
function inferDomainFromLabel(labelCn: string | undefined): TagDomain | null {
  if (!labelCn) return null
  const lc = labelCn
  if (/政治|涉政|领导人/.test(lc)) return 'politics'
  if (/色情|涉黄|低俗|性感/.test(lc)) return 'porn'
  if (/暴力|血腥|恐怖|暴恐/.test(lc)) return 'violence'
  if (/广告|绝对化|极限用语|承诺|资质/.test(lc)) return 'ads_law'
  if (/医疗|医药|药品|保健/.test(lc)) return 'medical'
  if (/金融|理财|投资|贷款|保险|信用卡/.test(lc)) return 'finance'
  if (/未成年|儿童|小学生/.test(lc)) return 'minor'
  if (/隐私|身份证|手机号|住址|个人信息/.test(lc)) return 'privacy'
  if (/商标|版权|品牌|logo|知识产权/.test(lc)) return 'ip'
  if (/赌博|博彩|彩票|赌/.test(lc)) return 'gambling'
  if (/欺诈|诈骗|刷单|兼职/.test(lc)) return 'fraud'
  if (/敏感/.test(lc)) return 'custom'
  return null
}

export default function TaskListPanel({ currentTaskId, onSelect }: Props) {
  const [items, setItems] = useState<ReviewTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [domainFilter, setDomainFilter] = useState<TagDomain | undefined>(undefined)

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

  // For each domain, count how many tasks have at least one matching hit.
  const domainCounts = useMemo(() => {
    const counts: Record<TagDomain, number> = {} as Record<TagDomain, number>
    for (const t of items) {
      const hits = t.agent_review?.hits ?? []
      const seen = new Set<TagDomain>()
      for (const h of hits) {
        const dom = inferDomainFromLabel(h.label_cn)
        if (dom) seen.add(dom)
      }
      for (const dom of seen) {
        counts[dom] = (counts[dom] ?? 0) + 1
      }
    }
    return counts
  }, [items])

  const visibleItems = useMemo(() => {
    if (!domainFilter) return items
    return items.filter((t) => {
      const hits = t.agent_review?.hits ?? []
      return hits.some((h) => inferDomainFromLabel(h.label_cn) === domainFilter)
    })
  }, [items, domainFilter])

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
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong>审核任务</Text>
          <Badge count={total} showZero color={colors.accent} overflowCount={99} />
        </div>
        <Space size={4} wrap>
          <CheckableTag
            checked={!domainFilter}
            onChange={(checked) => checked && setDomainFilter(undefined)}
          >
            全部
          </CheckableTag>
          {TAG_DOMAIN_OPTIONS.map((d) => {
            const n = domainCounts[d.value] ?? 0
            const disabled = n === 0 && domainFilter !== d.value
            return (
              <CheckableTag
                key={d.value}
                checked={domainFilter === d.value}
                onChange={(checked) =>
                  setDomainFilter(checked ? d.value : undefined)
                }
                style={{ opacity: disabled ? 0.5 : 1 }}
              >
                {d.cn}
                <span style={{ marginLeft: 4, color: colors.mutedSoft, fontSize: 11 }}>
                  {n}
                </span>
              </CheckableTag>
            )
          })}
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Spin spinning={loading}>
          <List
            dataSource={visibleItems}
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
                    borderBottom: `1px solid ${colors.divider}`,
                    borderLeft: active ? `3px solid ${colors.accent}` : '3px solid transparent',
                    background: active ? colors.accentSoft : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontWeight: active ? 600 : 500,
                      color: colors.primary,
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
                          color: colors.textSecondary,
                          borderLeft: `3px solid ${colors.destructive}`,
                          paddingLeft: 8,
                          background: colors.dangerSoft,
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
                      color: colors.mutedSoft,
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
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: '8px 12px', textAlign: 'center' }}>
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
