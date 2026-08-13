import { Card, Empty, Progress, Space, Spin, Table, Typography } from 'antd'
import { Line, Column, Pie, Area } from '@ant-design/charts'
import type {
  ReasonCount,
  TrendPoint,
  RiskTimeseriesPoint,
  RiskDistributionBucket,
  RiskLevel,
  TopRiskLabelItem,
} from '@/types/domain'

const { Text } = Typography

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
  series: { bucket: string; reject_rate: number; review_rate: number; approve_rate: number; submitted?: number }[]
  height?: number
  loading?: boolean
  error?: string | null
  emptyText?: string
  granularity?: 'hour' | 'day'
}

export function MultiMetricLineChart({
  series,
  height = 280,
  loading,
  error,
  emptyText = '暂无数据',
  granularity,
}: MultiMetricLineProps) {
  const labelFor = (b: string): string => {
    if (!granularity) return b.slice(5, 16).replace('T', ' ')
    if (granularity === 'day') {
      return b.slice(5, 10).replace('-', '.')
    }
    return b.slice(5, 16).replace('T', ' ')
  }
  const data = series.flatMap((p) => [
    { bucket: labelFor(p.bucket), metric: '拒绝率', value: p.reject_rate },
    { bucket: labelFor(p.bucket), metric: '审核率', value: p.review_rate },
    { bucket: labelFor(p.bucket), metric: '通过率', value: p.approve_rate },
    { bucket: labelFor(p.bucket), metric: '提交数', value: p.submitted },
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
    const out: { bucket: string; level: RiskLevel; count: number }[] = []
    if (p.high) out.push({ bucket: p.bucket, level: '高风险', count: p.high })
    if (p.medium) out.push({ bucket: p.bucket, level: '中风险', count: p.medium })
    if (p.low) out.push({ bucket: p.bucket, level: '低风险', count: p.low })
    if (p.sensitive) out.push({ bucket: p.bucket, level: '敏感', count: p.sensitive })
    if (p.none) out.push({ bucket: p.bucket, level: '无风险', count: p.none })
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
          xField="bucket"
          yField="count"
          seriesField="level"
          height={height}
          stack
          scale={{ color: { range: RISK_COLOR_LIST } }}
          style={{ fillOpacity: 0.7 }}
          axis={{
            x: {
              labelAutoRotate: false,
              labelFontSize: 10,
              labelFormatter: (v: string) => String(v).slice(5, 10),
            },
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
// Risk distribution trend — four lines (无风险 / 低风险 / 中风险 / 高风险)
// driven by ``/reports/risk/trend``. Each line is the percentage of the
// 4-level sum (高/中/低/无) for the bucket — 占比公式:
//     ratio(level) = count(level) / sum(high + medium + low + none) × 100
// ---------------------------------------------------------------------------

interface RiskTrendChartProps {
  points: RiskTimeseriesPoint[]
  height?: number
  loading?: boolean
  error?: string | null
  emptyText?: string
  /** Granularity drives x-axis label format. Defaults to 'day'. */
  granularity?: 'hour' | 'day' | 'month'
}

export function RiskTrendChart({
  points,
  height = 320,
  loading,
  error,
  emptyText = '暂无数据',
  granularity = 'day',
}: RiskTrendChartProps) {
  // 把每个 bucket 的 4 个 level 计数转成"占当天 4 个 level 之和"的百分比（0~100），
  // 保留 2 位小数。
  const data = points.flatMap((p) => {
    const denom = p.denominator || p.high + p.medium + p.low + p.none
    const safe = denom > 0 ? denom : 1
    const r2 = (n: number) => Number(((n / safe) * 100).toFixed(2))
    return [
      { bucket: p.bucket, level: '无风险', value: r2(p.none) },
      { bucket: p.bucket, level: '低风险', value: r2(p.low) },
      { bucket: p.bucket, level: '中风险', value: r2(p.medium) },
      { bucket: p.bucket, level: '高风险', value: r2(p.high) },
    ]
  })
  const hasData = data.some((d) => d.value > 0)

  // 4 条 series 的颜色配置 — 与手动 legend 的色块保持一致。
  const legendItems: { label: string; color: string }[] = [
    { label: '无风险', color: PASS_COLOR },
    { label: '低风险', color: APPROVE_COLOR },
    { label: '中风险', color: REVIEW_COLOR },
    { label: '高风险', color: REJECT_COLOR },
  ]

  const xLabelFormatter = (raw: string) => {
    if (!raw) return raw
    if (granularity === 'hour') {
      // YYYY-MM-DDTHH:MM:SS+00:00 → MM-DD HH:00
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/)
      return m ? `${m[2]}-${m[3]} ${m[4]}:00` : raw
    }
    if (granularity === 'month') {
      // YYYY-MM-01T00:00:00+00:00 → YYYY-MM
      return raw.slice(0, 7)
    }
    // day: YYYY-MM-DDTHH:MM:SS → MM-DD
    return raw.slice(5, 10)
  }

  const chart = (
    <Line
      data={data}
      xField="bucket"
      yField="value"
      colorField="level"
      scale={{
        color: {
          domain: ['无风险', '低风险', '中风险', '高风险'],
          range: [PASS_COLOR, APPROVE_COLOR, REVIEW_COLOR, REJECT_COLOR],
        },
        // 占比范围 0..100, Y 轴顶刻度给到 120 留出顶部 padding 空间，
        // 避免 100% 标签被 cartesian 区域裁掉.
        value: { min: 0, max: 120, tickCount: 5, nice: true },
      }}
      height={height}
      smooth
      animate={false}
      point={{ shapeField: 'circle', sizeField: 2 }}
      axis={{
        x: {
          labelAutoRotate: false,
          labelFontSize: 10,
          labelFormatter: (v: string) => xLabelFormatter(String(v)),
        },
        y: {
          labelFontSize: 10,
          labelFormatter: (v: number) => `${v.toFixed(2)}%`,
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

// ---------------------------------------------------------------------------
// Top N 风险标签 (趋势分析右侧栏) — 一级 / 二级 / 三级 标签维度
// ---------------------------------------------------------------------------

const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  // 低饱和度: Top N 柱状图统一走 slate-600 (5 条都是高风险, 用中性灰区分条与条)
  高风险: '#475569',
  中风险: '#64748B',
  低风险: '#94A3B8',
  敏感: '#CBD5E1',
  无风险: '#E2E8F0',
}

interface TopRiskChartProps {
  items: TopRiskLabelItem[]
  loading?: boolean
  emptyText?: string
  /** 列表视图列名 (随维度切换: 一级标签 / 二级标签 / 三级标签) */
  columnTitle?: string
}

export function TopRiskBarChart({ items, loading, emptyText = '暂无数据' }: TopRiskChartProps) {
  // 硬约束: 柱状图永远只展示前 5 条.
  const top5 = items.slice(0, 5)
  const body = (
    <>
      {top5.length === 0 ? (
        <Empty description={emptyText} />
      ) : (
        (() => {
          // 进度条按 percentage 绝对值 (0-100) 渲染, 首条拉满视觉.
          const maxPct = Math.max(...top5.map((it) => it.percentage ?? 0), 1)
          return (
            // flex 拉伸填满父容器 (360px), 5 条均分空间 — 与左栏趋势图上下水平对齐
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-around',
                minHeight: 0,
              }}
            >
              {top5.map((it, idx) => {
                const pctAbs = it.percentage ?? 0
                const pct = Math.max(2, Math.round((pctAbs / maxPct) * 100))
                return (
                  <div
                    key={`${it.label}-${idx}`}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <Space size={6} style={{ minWidth: 0, overflow: 'hidden' }}>
                        <Text type="secondary" style={{ fontSize: 12, minWidth: 18 }}>
                          {idx + 1}.
                        </Text>
                        <Text strong style={{ fontSize: 13 }} ellipsis>
                          {it.label}
                        </Text>
                      </Space>
                      <Text
                        style={{
                          fontSize: 13,
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0,
                          marginLeft: 8,
                        }}
                      >
                        {pctAbs.toFixed(2)}%
                      </Text>
                    </div>
                    <Progress
                      percent={pct}
                      showInfo={false}
                      strokeColor={RISK_LEVEL_COLOR['高风险']}
                      size="small"
                      style={{ marginBottom: 0 }}
                    />
                  </div>
                )
              })}
            </div>
          )
        })()
      )}
    </>
  )
  return <Spin spinning={!!loading}>{body}</Spin>
}

export function TopRiskTable({ items, loading, emptyText = '暂无数据', columnTitle = '标签' }: TopRiskChartProps) {
  // 列表视图: 全量展示 + 翻页. 柱状图 (TopRiskBarChart) 仍硬限 5 条.
  const columns = [
    {
      title: '#',
      width: 50,
      render: (_v: unknown, _r: TopRiskLabelItem, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {idx + 1}
        </Text>
      ),
    },
    {
      title: columnTitle,
      dataIndex: 'label',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      width: 100,
      render: (v: number | undefined) => (
        <Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(v ?? 0).toFixed(2)}%
        </Text>
      ),
    },
  ]
  const dataSource = items.map((it, i) => ({ ...it, key: `${it.label}-${i}` }))
  const body = items.length === 0 ? (
    <Empty description={emptyText} />
  ) : (
    <Table
      dataSource={dataSource}
      columns={columns}
      size="small"
      pagination={{
        pageSize: 5,
        showSizeChanger: false,
        showTotal: (total) => `共 ${total} 条`,
        size: 'small',
      }}
      showHeader
    />
  )
  return <Spin spinning={!!loading}>{body}</Spin>
}
