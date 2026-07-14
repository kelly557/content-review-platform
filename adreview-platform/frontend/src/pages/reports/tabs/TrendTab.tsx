import { useEffect, useState } from 'react'
import { Card, Col, Row, Select, Space, Statistic, Typography } from 'antd'
import { reportsApi } from '@/api/reports'
import type { OverviewStats, TrendMetric, TrendPoint, TrendResponse } from '@/types/domain'
import { TrendLineChart } from '../charts'

const { Text } = Typography

const WINDOW_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const METRIC_OPTIONS: { value: TrendMetric; label: string; color: string }[] = [
  { value: 'reject_rate', label: '拒绝率', color: '#DC2626' },
  { value: 'review_rate', label: '审核率', color: '#D97706' },
  { value: 'approve_rate', label: '通过率', color: '#16A34A' },
  { value: 'submitted', label: '提交量', color: '#2563EB' },
]

function formatDelta(delta: number | null | undefined, suffix = '%'): string {
  if (delta == null) return '—'
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '·'
  return `${arrow} ${Math.abs(delta).toFixed(2)}${suffix}`
}

export default function TrendTab() {
  const [window, setWindow] = useState('7d')
  const [metric, setMetric] = useState<TrendMetric>('reject_rate')
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [trend, setTrend] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    Promise.all([reportsApi.overview(window), reportsApi.trend({ metric, window })])
      .then(([ov, tr]) => {
        if (!alive) return
        setOverview(ov)
        setTrend(tr)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [window, metric])

  const points: TrendPoint[] = trend?.points ?? []
  const currentMetric = METRIC_OPTIONS.find((m) => m.value === metric) ?? METRIC_OPTIONS[0]
  const deltaSuffix = metric === 'submitted' ? '' : 'pp'

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Text type="secondary">时间窗</Text>
          <Select
            value={window}
            onChange={setWindow}
            options={WINDOW_OPTIONS}
            style={{ minWidth: 120 }}
          />
          <Text type="secondary">指标</Text>
          <Select
            value={metric}
            onChange={setMetric}
            options={METRIC_OPTIONS}
            style={{ minWidth: 140 }}
          />
        </Space>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          口径: 拒绝率 = 已驳回 / 已提交; 机审占比字段后端未提供, 暂不显示。
        </Text>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="今日拒绝率"
              value={overview?.reject_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#DC2626' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDelta(trend?.delta_pct ?? null, 'pp')}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={`${WINDOW_OPTIONS.find((w) => w.value === window)?.label ?? ''}审核率`}
              value={overview?.review_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#D97706' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={`${WINDOW_OPTIONS.find((w) => w.value === window)?.label ?? ''}通过率`}
              value={overview?.approve_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#16A34A' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="提交量"
              value={overview?.submitted ?? 0}
              valueStyle={{ color: currentMetric.color }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDelta(trend?.delta_pct ?? null, deltaSuffix)}
            </Text>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`${currentMetric.label}趋势 · ${WINDOW_OPTIONS.find((w) => w.value === window)?.label ?? ''}`}
        extra={<Text type="secondary">粒度: {trend?.granularity ?? '-'}</Text>}
      >
        <div style={{ height: 320 }}>
          <TrendLineChart
            points={points}
            metric={metric}
            loading={loading}
            error={err}
            height={320}
            yLabel={metric === 'submitted' ? '提交量' : '百分比'}
          />
        </div>
      </Card>
    </Space>
  )
}
