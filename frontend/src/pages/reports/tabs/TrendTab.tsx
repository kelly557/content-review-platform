import { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Col,
  DatePicker,
  Row,
  Segmented,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { reportsApi, type MockMode } from '@/api/reports'
import type {
  AuditModality,
  RiskTimeseriesPoint,
  RiskTrendGranularity,
  RiskTrendOptionsResponse,
  TopRiskLabelItem,
} from '@/types/domain'
import { AUDIT_MODALITIES } from '@/types/domain'
import RiskLabelCascade from '@/components/query/RiskLabelCascade'
import { RiskTrendChart, TopRiskBarChart, TopRiskTable } from '../charts'

const { Text } = Typography
const { RangePicker } = DatePicker

type WindowKey = 'today' | '7d' | '30d' | 'custom'

const WINDOW_SEGMENTS: { value: Exclude<WindowKey, 'custom'>; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const DIMENSION_LABEL: Record<'category' | 'item' | 'point', string> = {
  category: '一级标签',
  item: '二级标签',
  point: '三级标签',
}

const GRANULARITY_SEGMENTS: { value: RiskTrendGranularity; label: string }[] = [
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
  { value: 'month', label: '月' },
]

// Match the backend cap (see app.services.report_metrics.MAX_CUSTOM_WINDOW).
const MAX_RANGE_DAYS = 90

// 4 张 Statistic 卡片的固定顺序（按风险等级由低到高）。
const RISK_LEVEL_CARDS = [
  { key: 'none', label: '无风险', color: '#94A3B8' },
  { key: 'low', label: '低风险', color: '#2563EB' },
  { key: 'medium', label: '中风险', color: '#D97706' },
  { key: 'high', label: '高风险', color: '#DC2626' },
] as const



export default function TrendTab({ mock }: { mock?: MockMode } = {}) {
  const [windowKey, setWindowKey] = useState<WindowKey>('7d')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [modalities, setModalities] = useState<AuditModality[]>([])
  const [strategyCodes, setStrategyCodes] = useState<string[]>([])
  const [ips, setIps] = useState<string[]>([])
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [riskLabelPaths, setRiskLabelPaths] = useState<string[]>([])
  const [granularity, setGranularity] = useState<RiskTrendGranularity | null>(null)
  const [riskPoints, setRiskPoints] = useState<RiskTimeseriesPoint[]>([])
  const [topRiskItems, setTopRiskItems] = useState<TopRiskLabelItem[]>([])
  const [topRiskView, setTopRiskView] = useState<'chart' | 'list'>('chart')
  const [topRiskDimension, setTopRiskDimension] = useState<'category' | 'item' | 'point'>('point')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [options, setOptions] = useState<RiskTrendOptionsResponse | null>(null)

  const isCustom = windowKey === 'custom'
  const rangeValid = !!customRange && customRange[1].isAfter(customRange[0])

  // 拉取筛选项（每个会话拉一次）.
  useEffect(() => {
    let alive = true
    reportsApi
      .riskTrendOptions(mock?.enabled ? mock : undefined)
      .then((opt) => {
        if (alive) setOptions(opt)
      })
      .catch(() => {
        if (alive) setOptions(null)
      })
    return () => {
      alive = false
    }
  }, [mock?.enabled, mock?.seed])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)

    const base: Parameters<typeof reportsApi.riskTrend>[0] = {
      modalities: modalities.length ? modalities : undefined,
      strategy_codes: strategyCodes.length ? strategyCodes : undefined,
      ips: ips.length ? ips : undefined,
      account_ids: accountIds.length ? accountIds : undefined,
      channels: channels.length ? channels : undefined,
      risk_label_paths: riskLabelPaths.length ? riskLabelPaths : undefined,
      granularity: granularity ?? undefined,
    }
    if (isCustom && rangeValid && customRange) {
      base.start = customRange[0].startOf('day').toISOString()
      base.end = customRange[1].endOf('day').toISOString()
    } else {
      base.window = windowKey === 'today' ? 'today' : windowKey === '30d' ? '30d' : '7d'
    }
    const mockArg = mock?.enabled ? mock : undefined

    Promise.all([
      reportsApi.riskTrend(base, mockArg),
      reportsApi.riskTopLabels({ ...base, limit: 5, dimension: topRiskDimension }, mockArg),
    ])
      .then(([rt, top]) => {
        if (!alive) return
        setRiskPoints(rt.points)
        setTopRiskItems(top.items)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [
    windowKey,
    customRange,
    isCustom,
    rangeValid,
    modalities,
    strategyCodes,
    ips,
    accountIds,
    channels,
    riskLabelPaths,
    granularity,
    topRiskDimension,
    mock?.enabled,
    mock?.seed,
  ])

  // 4 张风险等级卡片：占比 = 该等级条数 / sum_of_4 (denominator).
  const riskTotals = useMemo(() => {
    return riskPoints.reduce(
      (acc, p) => {
        acc.none += p.none
        acc.low += p.low
        acc.medium += p.medium
        acc.high += p.high
        return acc
      },
      { none: 0, low: 0, medium: 0, high: 0 },
    )
  }, [riskPoints])

  const denominator = riskTotals.none + riskTotals.low + riskTotals.medium + riskTotals.high

  const disabledDate = (current: Dayjs) => {
    const anchor = customRange?.[0]
    if (!anchor) return current.isAfter(dayjs().endOf('day'))
    const span = current.diff(anchor, 'day')
    return current.isAfter(dayjs().endOf('day')) || span > MAX_RANGE_DAYS
  }

  const effectiveGranularity = useMemo<RiskTrendGranularity>(() => {
    if (granularity) return granularity
    if (windowKey === 'today') return 'hour'
    if (windowKey === '30d') return 'day'
    return 'day'
  }, [granularity, windowKey])

  const sensitivityCount = useMemo(
    () => riskPoints.reduce((s, p) => s + p.sensitive, 0),
    [riskPoints],
  )

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size="middle" align="center">
          <Segmented
            value={isCustom ? '' : windowKey}
            onChange={(v) => {
              const next = v as Exclude<WindowKey, 'custom'>
              setWindowKey(next)
              setCustomRange(null)
            }}
            options={WINDOW_SEGMENTS}
          />
          <RangePicker
            value={customRange ?? undefined}
            onChange={(vals) => {
              const next =
                vals && vals[0] && vals[1] ? ([vals[0], vals[1]] as [Dayjs, Dayjs]) : null
              setCustomRange(next)
              if (next) setWindowKey('custom')
              else setWindowKey('7d')
            }}
            disabledDate={disabledDate}
            allowClear
            placeholder={['开始日期', '结束日期']}
          />
          <Select
            mode="multiple"
            allowClear
            value={modalities}
            onChange={(v) => setModalities(v as AuditModality[])}
            options={AUDIT_MODALITIES}
            placeholder="审核模态"
            style={{ minWidth: 180 }}
            maxTagCount="responsive"
          />
          <Select
            mode="multiple"
            allowClear
            value={strategyCodes}
            onChange={(v) => setStrategyCodes(v as string[])}
            options={options?.strategies ?? []}
            placeholder="策略名称"
            style={{ minWidth: 160 }}
            maxTagCount="responsive"
          />
          <Select
            mode="tags"
            allowClear
            value={ips}
            onChange={(v) => setIps(v as string[])}
            options={options?.ips ?? []}
            placeholder="IP"
            style={{ minWidth: 160 }}
            maxTagCount="responsive"
          />
          <Select
            mode="multiple"
            allowClear
            value={accountIds}
            onChange={(v) => setAccountIds(v as string[])}
            options={options?.account_ids ?? []}
            placeholder="账号"
            style={{ minWidth: 140 }}
            maxTagCount="responsive"
          />
          <Select
            mode="tags"
            allowClear
            value={channels}
            onChange={(v) => setChannels(v as string[])}
            options={options?.channels ?? []}
            placeholder="渠道"
            style={{ minWidth: 140 }}
            maxTagCount="responsive"
          />
          <div style={{ minWidth: 220 }}>
            <RiskLabelCascade
              taxonomy={options?.risk_taxonomy ?? []}
              value={riskLabelPaths}
              onChange={setRiskLabelPaths}
              placeholder="审核项 / 审核点 / sub 审核点"
            />
          </div>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Tooltip title="某风险占比 = 该风险等级条数 / 所有风险等级条数之和; 敏感单独展示，不进入占比分母。">
            <Text type="secondary" style={{ fontSize: 12 }}>
              某风险占比 = 该风险等级条数 / 所有风险等级条数之和；自定义区间最长 {MAX_RANGE_DAYS} 天。
            </Text>
          </Tooltip>
        </div>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Row gutter={[16, 16]}>
        {RISK_LEVEL_CARDS.map((c) => {
          const count = riskTotals[c.key]
          const ratio = denominator > 0 ? (count / denominator) * 100 : 0
          return (
            <Col xs={12} md={6} key={c.key}>
              <Card size="small">
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {c.label}
                </Text>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 600,
                      lineHeight: 1.2,
                      color: c.color,
                    }}
                  >
                    {count}
                    <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>条</span>
                  </span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    占比 {ratio.toFixed(2)}%
                  </Text>
                </div>
              </Card>
            </Col>
          )
        })}
      </Row>

      {sensitivityCount > 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          敏感 PII: {sensitivityCount} 条（不计入占比分母）
        </Text>
      )}

      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Card
            size="small"
            title="趋势统计"
            extra={
              <Space size="small" align="center">
                <Text type="secondary">颗粒度</Text>
                <Segmented
                  value={granularity ?? '__auto'}
                  onChange={(v) =>
                    setGranularity(v === '__auto' ? null : (v as RiskTrendGranularity))
                  }
                  options={[
                    { value: '__auto', label: '自动' },
                    ...GRANULARITY_SEGMENTS,
                  ]}
                />
              </Space>
            }
          >
            <div style={{ height: 360 }}>
              <RiskTrendChart
                points={riskPoints}
                loading={loading}
                error={err}
                height={360}
                granularity={effectiveGranularity}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card
            size="small"
            title="风险分布"
            extra={
              <Segmented
                value={topRiskView}
                onChange={(v) => setTopRiskView(v as 'chart' | 'list')}
                options={[
                  { value: 'chart', label: 'Top 5高风险' },
                  { value: 'list', label: '全量列表' },
                ]}
              />
            }
          >
            <div style={{ height: 360, display: 'flex', flexDirection: 'column' }}>
              <Space size={8} style={{ marginBottom: 8, flexShrink: 0 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  维度
                </Text>
                <Segmented
                  value={topRiskDimension}
                  onChange={(v) =>
                    setTopRiskDimension(v as 'category' | 'item' | 'point')
                  }
                  options={[
                    { value: 'category', label: '一级标签' },
                    { value: 'item', label: '二级标签' },
                    { value: 'point', label: '三级标签' },
                  ]}
                />
              </Space>
              <div style={{ flex: 1, minHeight: 0 }}>
                {topRiskView === 'chart' ? (
                  <TopRiskBarChart items={topRiskItems} loading={loading} />
                ) : (
                  <TopRiskTable items={topRiskItems} loading={loading} columnTitle={DIMENSION_LABEL[topRiskDimension]} />
                )}
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
