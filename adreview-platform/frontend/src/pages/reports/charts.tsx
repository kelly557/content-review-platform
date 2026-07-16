import { Card, Empty, Space, Spin } from 'antd'
import { Line, Column, Pie, Area } from '@ant-design/charts'
import type {
  ReasonCount,
  TrendPoint,
  RiskTimeseriesPoint,
  RiskDistributionBucket,
  RiskLevel,
} from '@/types/domain'

const REJECT_COLOR = '#DC2626'
const REVIEW_COLOR = '#D97706'
const APPROVE_COLOR = '#16A34A'
const SUBMIT_COLOR = '#2563EB'
const PASS_COLOR = '#94A3B8'

interface TrendLineProps {
  points: TrendPoint[]
  metric: 'reject_rate' | 'review_rate' | 'approve_rate' | 'submitted'
  height?: number
  yLabel?: string
  loading?: boolean
  error?: string | null
  emptyText?: string
}

const METRIC_META: Record<TrendLineProps['metric'], { color: string; suffix: string; label: string }> = {
  reject_rate: { color: REJECT_COLOR, suffix: '%', label: '拒绝率' },
  review_rate: { color: REVIEW_COLOR, suffix: '%', label: '审核率' },
  approve_rate: { color: APPROVE_COLOR, suffix: '%', label: '通过率' },
  submitted: { color: SUBMIT_COLOR, suffix: '', label: '提交量' },
}

export function TrendLineChart({
  points,
  metric,
  height = 280,
  yLabel,
  loading,
  error,
  emptyText = '暂无数据',
}: TrendLineProps) {
  const meta = METRIC_META[metric]
  const data = points.map((p) => ({
    bucket: p.bucket.slice(5, 16).replace('T', ' '),
    value: Number(p.value.toFixed(2)),
  }))
  const body = (
    <>
      {error ? (
        <Empty description={error} />
      ) : data.length === 0 ? (
        <Empty description={emptyText} />
      ) : (
        <Line
          data={data}
          xField="bucket"
          yField="value"
          height={height}
          smooth
          animate={false}
          color={meta.color}
          point={{ shapeField: 'circle', sizeField: 3 }}
          axis={{
            x: { labelAutoRotate: false, labelFontSize: 10 },
            y: {
              labelFontSize: 10,
              title: yLabel ? { text: yLabel } : undefined,
              labelFormatter: (v: number) => `${v}${meta.suffix}`,
            },
          }}
          style={{ fillOpacity: 0.15 }}
          legend={false}
        />
      )}
    </>
  )
  return (
    <Spin spinning={!!loading}>
      {body}
    </Spin>
  )
}

interface MultiMetricLineProps {
  series: { bucket: string; reject_rate: number; review_rate: number; approve_rate: number }[]
  height?: number
  loading?: boolean
  error?: string | null
  emptyText?: string
}

export function MultiMetricLineChart({
  series,
  height = 280,
  loading,
  error,
  emptyText = '暂无数据',
}: MultiMetricLineProps) {
  const data = series.flatMap((p) => [
    { bucket: p.bucket.slice(5, 16).replace('T', ' '), metric: '拒绝率', value: p.reject_rate },
    { bucket: p.bucket.slice(5, 16).replace('T', ' '), metric: '审核率', value: p.review_rate },
    { bucket: p.bucket.slice(5, 16).replace('T', ' '), metric: '通过率', value: p.approve_rate },
  ])
  return (
    <Spin spinning={!!loading}>
      {error ? (
        <Empty description={error} />
      ) : data.length === 0 ? (
        <Empty description={emptyText} />
      ) : (
        <Line
          data={data}
          xField="bucket"
          yField="value"
          seriesField="metric"
          height={height}
          smooth
          animate={false}
          color={[REJECT_COLOR, REVIEW_COLOR, APPROVE_COLOR]}
          point={{ shapeField: 'circle', sizeField: 2 }}
          axis={{
            x: { labelAutoRotate: false, labelFontSize: 10 },
            y: { labelFontSize: 10, labelFormatter: (v: number) => `${v}%` },
          }}
          style={{ fillOpacity: 0.1 }}
          legend={{ color: { position: 'top-right' } }}
        />
      )}
    </Spin>
  )
}

interface ReasonBarProps {
  data: ReasonCount[]
  title: string
  color?: string
  loading?: boolean
  error?: string | null
  height?: number
}

export function ReasonBarChart({
  data,
  title,
  color = REJECT_COLOR,
  loading,
  error,
  height = 260,
}: ReasonBarProps) {
  const rows = data.map((d) => ({ label: d.label, count: d.count }))
  return (
    <Card title={title} size="small">
      <Spin spinning={!!loading}>
        {error ? (
          <Empty description={error} />
        ) : rows.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Column
            data={rows}
            xField="count"
            yField="label"
            height={height}
            colorField={() => 'count'}
            color={color}
            label={{ position: 'right', style: { fill: '#475569', fontSize: 11 } }}
            axis={{ x: { labelFontSize: 10 }, y: { labelFontSize: 11 } }}
            animate={false}
          />
        )}
      </Spin>
    </Card>
  )
}

interface TagPieProps {
  data: ReasonCount[]
  title: string
  loading?: boolean
  error?: string | null
  height?: number
}

const PIE_PALETTE = ['#DC2626', '#D97706', '#2563EB', '#16A34A', '#7C3AED', '#0EA5E9', '#EC4899', '#F59E0B']

export function TagPieChart({ data, title, loading, error, height = 260 }: TagPieProps) {
  const rows = data.map((d, i) => ({
    type: d.label,
    value: d.count,
    color: PIE_PALETTE[i % PIE_PALETTE.length],
  }))
  return (
    <Card title={title} size="small">
      <Spin spinning={!!loading}>
        {error ? (
          <Empty description={error} />
        ) : rows.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Pie
            data={rows}
            angleField="value"
            colorField="type"
            radius={0.85}
            innerRadius={0.55}
            height={height}
            color={({ type }: { type: string }) => rows.find((r) => r.type === type)?.color ?? '#94A3B8'}
            legend={{ color: { position: 'right' } }}
            label={{ type: 'inner', content: '{percentage}', style: { fontSize: 11 } }}
            animate={false}
          />
        )}
      </Spin>
    </Card>
  )
}

// ─── Risk profile charts (v3 新增) ───────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  高风险: '#DC2626',
  中风险: '#D97706',
  低风险: '#2563EB',
  敏感: '#7C3AED',
  无风险: '#94A3B8',
}

const RISK_COLOR_LIST = [
  RISK_COLOR['高风险'],
  RISK_COLOR['中风险'],
  RISK_COLOR['低风险'],
  RISK_COLOR['敏感'],
  RISK_COLOR['无风险'],
]

interface RiskStackedAreaProps {
  points: RiskTimeseriesPoint[]
  height?: number
  loading?: boolean
  error?: string | null
  emptyText?: string
}

export function RiskStackedAreaChart({
  points,
  height = 280,
  loading,
  error,
  emptyText = '暂无数据',
}: RiskStackedAreaProps) {
  const rows = points.flatMap((p) => {
    const out: { date: string; level: RiskLevel; count: number }[] = []
    if (p.high) out.push({ date: p.date, level: '高风险', count: p.high })
    if (p.medium) out.push({ date: p.date, level: '中风险', count: p.medium })
    if (p.low) out.push({ date: p.date, level: '低风险', count: p.low })
    if (p.sensitive) out.push({ date: p.date, level: '敏感', count: p.sensitive })
    if (p.none) out.push({ date: p.date, level: '无风险', count: p.none })
    return out
  })
  return (
    <Spin spinning={!!loading}>
      {error ? (
        <Empty description={error} />
      ) : rows.length === 0 ? (
        <Empty description={emptyText} />
      ) : (
        <Area
          data={rows}
          xField="date"
          yField="count"
          seriesField="level"
          height={height}
          stack
          scale={{ color: { range: RISK_COLOR_LIST } }}
          style={{ fillOpacity: 0.7 }}
          axis={{
            x: { labelAutoRotate: false, labelFontSize: 10 },
            y: { labelFontSize: 10 },
          }}
          legend={{ color: { position: 'top-right' } }}
        />
      )}
    </Spin>
  )
}

interface RiskDistributionBarProps {
  buckets: RiskDistributionBucket[]
  height?: number
  loading?: boolean
  error?: string | null
}

export function RiskDistributionBarChart({
  buckets,
  height = 280,
  loading,
  error,
}: RiskDistributionBarProps) {
  const rows = buckets.map((b) => ({
    level: b.level,
    count: b.count,
    color: RISK_COLOR[b.level] ?? '#94A3B8',
  }))
  return (
    <Spin spinning={!!loading}>
      {error ? (
        <Empty description={error} />
      ) : rows.length === 0 ? (
        <Empty description="暂无数据" />
      ) : (
        <Column
          data={rows}
          xField="count"
          yField="level"
          height={height}
          colorField="level"
          color={RISK_COLOR}
          label={{ position: 'right', style: { fill: '#475569', fontSize: 11 } }}
          axis={{ x: { labelFontSize: 10 }, y: { labelFontSize: 11 } }}
          animate={false}
        />
      )}
    </Spin>
  )
}

// ---------------------------------------------------------------------------
// Risk distribution trend — four lines (已通过 / 低风险 / 中风险 / 高风险)
// driven by ``/reports/risk/trend``. "已通过" is computed client-side as
// ``low + none`` per the spec; it does not have its own backend column yet.
// ---------------------------------------------------------------------------

interface RiskTrendChartProps {
  points: RiskTimeseriesPoint[]
  height?: number
  loading?: boolean
  error?: string | null
  emptyText?: string
}

export function RiskTrendChart({
  points,
  height = 320,
  loading,
  error,
  emptyText = '暂无数据',
}: RiskTrendChartProps) {
  // 把每个 bucket 的 4 个 level 计数转成"占当天 4 个 level 之和"的百分比。
  const data = points.flatMap((p) => {
    const sum = p.high + p.medium + p.low + p.none
    const safe = sum > 0 ? sum : 1
    return [
      { bucket: p.date, level: '已通过', value: ((p.low + p.none) / safe) * 100 },
      { bucket: p.date, level: '低风险', value: (p.low / safe) * 100 },
      { bucket: p.date, level: '中风险', value: (p.medium / safe) * 100 },
      { bucket: p.date, level: '高风险', value: (p.high / safe) * 100 },
    ]
  })
  const hasData = data.some((d) => d.value > 0)

  // 4 条 series 的颜色配置 — 与手动 legend 的色块保持一致。
  const legendItems: { label: string; color: string }[] = [
    { label: '已通过', color: PASS_COLOR },
    { label: '低风险', color: APPROVE_COLOR },
    { label: '中风险', color: REVIEW_COLOR },
    { label: '高风险', color: REJECT_COLOR },
  ]

  const chart = (
    <Line
      data={data}
      xField="bucket"
      yField="value"
      seriesField="level"
      height={height}
      smooth
      animate={false}
      color={({ level }: { level: string }) => {
        switch (level) {
          case '已通过':
            return PASS_COLOR
          case '低风险':
            return APPROVE_COLOR
          case '中风险':
            return REVIEW_COLOR
          case '高风险':
            return REJECT_COLOR
          default:
            return '#94A3B8'
        }
      }}
      point={{ shapeField: 'circle', sizeField: 2 }}
      axis={{
        x: { labelAutoRotate: false, labelFontSize: 10 },
        y: {
          labelFontSize: 10,
          labelFormatter: (v: number) => `${v.toFixed(0)}%`,
        },
      }}
      style={{ fillOpacity: 0.1 }}
      legend={false}
    />
  )

  const body = (
    <>
      {error ? (
        <Empty description={error} />
      ) : !hasData ? (
        <Empty description={emptyText} />
      ) : (
        <>
          {chart}
          <Space size="middle" wrap style={{ marginTop: 8, justifyContent: 'center', width: '100%' }}>
            {legendItems.map((it) => (
              <Space key={it.label} size={6} align="center">
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: it.color,
                  }}
                />
                <span style={{ fontSize: 12, color: '#475569' }}>{it.label}</span>
              </Space>
            ))}
          </Space>
        </>
      )}
    </>
  )
  return <Spin spinning={!!loading}>{body}</Spin>
}
