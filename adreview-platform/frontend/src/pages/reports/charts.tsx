import { Card, Empty, Spin } from 'antd'
import { Line, Column, Pie } from '@ant-design/charts'
import type { ReasonCount, TrendPoint } from '@/types/domain'

const REJECT_COLOR = '#DC2626'
const REVIEW_COLOR = '#D97706'
const APPROVE_COLOR = '#16A34A'
const SUBMIT_COLOR = '#2563EB'

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
