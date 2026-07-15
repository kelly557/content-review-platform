import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { reportsApi } from '@/api/reports'
import type {
  RiskTrendResponse,
  RiskDistributionResponse,
  TopRiskLabelsResponse,
} from '@/api/reports'
import { strategiesApi } from '@/api/strategies'
import type {
  MaterialType,
  RiskLevel,
  TopRiskLabelItem,
} from '@/types/domain'
import {
  MATERIAL_TYPE_OPTIONS,
  RISK_LEVEL_OPTIONS,
  AUDIT_POINT_DOMAIN_OPTIONS,
  ALL_AUDIT_POINT_DOMAINS,
} from '@/lib/reportsFilterOptions'
import {
  sumRiskLevels,
  filterRiskTimeseries,
  filterRiskDistribution,
  filterTopAuditPointsByDomain,
  stripViolationTermsFromSensitive,
} from '@/lib/reportsDerived'
import { RiskStackedAreaChart, RiskDistributionBarChart } from '../charts'

const { Text } = Typography

const DAYS_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
]

const SUMMARY_CARDS: {
  key: keyof ReturnType<typeof sumRiskLevels>
  label: string
  hint?: string
  color: string
}[] = [
  { key: 'high', label: '高风险', hint: '涉政/暴恐/医疗违规等', color: '#DC2626' },
  { key: 'medium', label: '中风险', hint: '广告法/金融违规等', color: '#D97706' },
  { key: 'low', label: '低风险', color: '#2563EB' },
  { key: 'sensitive', label: '敏感 (PII)', hint: '身份证/手机号/银行卡等 PII 数据', color: '#7C3AED' },
  { key: 'none', label: '无风险', color: '#94A3B8' },
]

function groupTopByLevel(
  items: TopRiskLabelItem[],
  selected: RiskLevel[],
): { level: RiskLevel; items: TopRiskLabelItem[] }[] {
  const byLevel = new Map<RiskLevel, TopRiskLabelItem[]>()
  for (const it of items) {
    if (!selected.includes(it.risk_level)) continue
    const arr = byLevel.get(it.risk_level) ?? []
    arr.push(it)
    byLevel.set(it.risk_level, arr)
  }
  return selected
    .map((lv) => ({ level: lv, items: (byLevel.get(lv) ?? []).slice(0, 5) }))
    .filter((g) => g.items.length > 0)
}

export default function RiskProfileTab() {
  const [days, setDays] = useState<number>(7)
  const [strategyCode, setStrategyCode] = useState<string | null>(null)
  const [materialType, setMaterialType] = useState<MaterialType | null>(null)
  const [riskLevels, setRiskLevels] = useState<RiskLevel[]>(
    RISK_LEVEL_OPTIONS.map((o) => o.value),
  )
  const [auditPointDomains, setAuditPointDomains] =
    useState<typeof ALL_AUDIT_POINT_DOMAINS>(ALL_AUDIT_POINT_DOMAINS)

  const [strategies, setStrategies] = useState<{ code: string; name: string }[]>([])
  const [trend, setTrend] = useState<RiskTrendResponse | null>(null)
  const [dist, setDist] = useState<RiskDistributionResponse | null>(null)
  const [top, setTop] = useState<TopRiskLabelsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    strategiesApi
      .list({ size: 100 })
      .then((page) => {
        setStrategies(
          page.items
            .filter((s) => s.is_active)
            .map((s) => ({ code: s.code, name: s.name })),
        )
      })
      .catch(() => setStrategies([]))
  }, [])

  const fetchAll = async (d: number) => {
    setLoading(true)
    setErr(null)
    try {
      const [t, di, tp] = await Promise.all([
        reportsApi.riskTrend(d),
        reportsApi.riskDistribution(d),
        reportsApi.riskTopLabels(d, 20),
      ])
      setTrend(t)
      setDist(di)
      setTop(tp)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchAll(days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  const filteredTrend = useMemo(
    () => (trend ? filterRiskTimeseries(trend.points, riskLevels) : []),
    [trend, riskLevels],
  )
  const filteredDist = useMemo(
    () => (dist ? filterRiskDistribution(dist.buckets, riskLevels) : []),
    [dist, riskLevels],
  )
  const filteredTop = useMemo(
    () =>
      top
        ? stripViolationTermsFromSensitive(
            filterTopAuditPointsByDomain(top.items, auditPointDomains),
          )
        : [],
    [top, auditPointDomains],
  )
  const summary = useMemo(() => sumRiskLevels(filteredTrend), [filteredTrend])
  const topByLevel = useMemo(
    () => groupTopByLevel(filteredTop, ['高风险', '中风险', '敏感']),
    [filteredTop],
  )

  const strategyOptions = useMemo(
    () => [
      { value: '', label: '全部策略' },
      ...strategies.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
    ],
    [strategies],
  )

  const allRiskChecked = riskLevels.length === RISK_LEVEL_OPTIONS.length
  const allDomainChecked = auditPointDomains.length === AUDIT_POINT_DOMAIN_OPTIONS.length

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space wrap>
            <Text type="secondary">时间窗</Text>
            <Select
              value={days}
              onChange={setDays}
              options={DAYS_OPTIONS}
              style={{ minWidth: 120 }}
            />
            <Text type="secondary">策略</Text>
            <Select
              value={strategyCode ?? ''}
              onChange={(v) => setStrategyCode(v ? v : null)}
              options={strategyOptions}
              placeholder="全部策略"
              allowClear
              style={{ minWidth: 200 }}
            />
            <Text type="secondary">素材</Text>
            <Select
              value={materialType ?? ''}
              onChange={(v) => setMaterialType(v ? (v as MaterialType) : null)}
              options={[
                { value: '', label: '全部' },
                ...MATERIAL_TYPE_OPTIONS,
              ]}
              placeholder="全部"
              allowClear
              style={{ minWidth: 120 }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void fetchAll(days)}
              loading={loading}
            >
              刷新
            </Button>
          </Space>

          <Space wrap size="middle">
            <Text type="secondary">风险等级</Text>
            <Checkbox.Group
              options={RISK_LEVEL_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
              value={riskLevels}
              onChange={(vals) => setRiskLevels(vals as RiskLevel[])}
            />
            <Button
              size="small"
              type="link"
              onClick={() =>
                setRiskLevels(
                  allRiskChecked ? [] : RISK_LEVEL_OPTIONS.map((o) => o.value),
                )
              }
            >
              {allRiskChecked ? '清空' : '全选'}
            </Button>
          </Space>

          <Space wrap size="middle">
            <Text type="secondary">审核项分类</Text>
            <Checkbox.Group
              options={AUDIT_POINT_DOMAIN_OPTIONS}
              value={auditPointDomains}
              onChange={(vals) =>
                setAuditPointDomains(vals as typeof ALL_AUDIT_POINT_DOMAINS)
              }
            />
            <Button
              size="small"
              type="link"
              onClick={() =>
                setAuditPointDomains(
                  allDomainChecked ? [] : ALL_AUDIT_POINT_DOMAINS,
                )
              }
            >
              {allDomainChecked ? '清空' : '全选'}
            </Button>
          </Space>

          <Text type="secondary" style={{ fontSize: 12 }}>
            口径: 5 档风险等级 = 素材整体严重度 (高/中/低/无) + PII 维度 (敏感);
            涉政/涉黄/暴恐等违规走高/中风险, 不会落入"敏感"档;
            "敏感"档仅承载 PII (身份证/手机号/银行卡等), 与"涉政"互斥。
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            策略 / 素材维度后端未支持, 切换仅影响前端展示;
            风险等级 / 审核项分类 在前端二次过滤。
          </Text>
        </Space>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Row gutter={[16, 16]}>
        {SUMMARY_CARDS.map((c) => (
          <Col key={c.key} xs={12} md={4}>
            <Card size="small">
              <Statistic
                title={c.label}
                value={summary[c.key] ?? 0}
                valueStyle={{ color: c.color, fontSize: 22 }}
              />
              {c.hint && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {c.hint}
                </Text>
              )}
            </Card>
          </Col>
        ))}
        <Col xs={24} md={4}>
          <Card size="small">
            <Statistic
              title="合计 (过滤后)"
              value={summary.total}
              valueStyle={{ fontSize: 22 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card size="small" title="风险等级堆叠趋势">
            <div style={{ height: 320 }}>
              <RiskStackedAreaChart
                points={filteredTrend}
                loading={loading}
                error={err}
                emptyText="所选风险等级无数据"
                height={320}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card size="small" title="风险等级分布">
            <div style={{ height: 320 }}>
              <RiskDistributionBarChart
                buckets={filteredDist}
                loading={loading}
                error={err}
                height={320}
              />
            </div>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Top 命中审核点 (违规与 PII 分开)">
        {auditPointDomains.length === 0 ? (
          <Empty description="请至少选择一个审核项分类" />
        ) : topByLevel.length === 0 ? (
          <Empty description="所选维度无命中数据" />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Text strong>违规审核点 (高/中/低风险)</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                涉政/涉黄/暴恐/广告法等违规语义
              </Text>
            </div>
            <Row gutter={[16, 16]}>
              {topByLevel
                .filter((g) => g.level !== '敏感')
                .map((g) => {
                  const color =
                    RISK_LEVEL_OPTIONS.find((o) => o.value === g.level)?.color ?? '#475569'
                  return (
                    <Col key={g.level} xs={24} md={8}>
                      <Card
                        size="small"
                        title={
                          <Space>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                background: color,
                              }}
                            />
                            <span>{g.level} Top {g.items.length}</span>
                          </Space>
                        }
                      >
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          {g.items.map((it, idx) => (
                            <Row key={`${g.level}-${it.label}-${idx}`} justify="space-between">
                              <Col style={{ fontSize: 12 }}>
                                <Text type="secondary" style={{ marginRight: 6 }}>
                                  {idx + 1}.
                                </Text>
                                {it.label}
                              </Col>
                              <Col>
                                <Text strong>{it.count}</Text>
                              </Col>
                            </Row>
                          ))}
                        </Space>
                      </Card>
                    </Col>
                  )
                })}
            </Row>

            {topByLevel.some((g) => g.level === '敏感') && (
              <>
                <div>
                  <Text strong>敏感 PII 命中</Text>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    身份证/手机号/银行卡等 PII 数据
                  </Text>
                </div>
                <Row gutter={[16, 16]}>
                  {topByLevel
                    .filter((g) => g.level === '敏感')
                    .map((g) => {
                      const color =
                        RISK_LEVEL_OPTIONS.find((o) => o.value === g.level)?.color ?? '#475569'
                      return (
                        <Col key={g.level} xs={24} md={8}>
                          <Card
                            size="small"
                            title={
                              <Space>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    width: 8,
                                    height: 8,
                                    borderRadius: 4,
                                    background: color,
                                  }}
                                />
                                <span>敏感 (PII) Top {g.items.length}</span>
                              </Space>
                            }
                          >
                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                              {g.items.map((it, idx) => (
                                <Row key={`${g.level}-${it.label}-${idx}`} justify="space-between">
                                  <Col style={{ fontSize: 12 }}>
                                    <Text type="secondary" style={{ marginRight: 6 }}>
                                      {idx + 1}.
                                    </Text>
                                    {it.label}
                                  </Col>
                                  <Col>
                                    <Text strong>{it.count}</Text>
                                  </Col>
                                </Row>
                              ))}
                            </Space>
                          </Card>
                        </Col>
                      )
                    })}
                </Row>
              </>
            )}
          </Space>
        )}
      </Card>

      <Text type="secondary" style={{ fontSize: 12 }}>
        数据源: GET /reports/risk/{'{trend,distribution,top-labels}'};
        业务口径: 审核项 = AuditItem / AuditPoint;
        审核项分类 = 后端 TagDomain 枚举;
        风险等级 5 档中"敏感"档仅承载 PII (与涉政互斥)。
      </Text>
    </Space>
  )
}
