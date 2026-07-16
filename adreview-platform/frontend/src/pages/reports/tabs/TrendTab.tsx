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
import { reportsApi } from '@/api/reports'
import type {
  DetectionModality,
  MaterialType,
  RiskTimeseriesPoint,
} from '@/types/domain'
import { DETECTION_MODALITIES } from '@/types/domain'
import { MATERIAL_TYPE_OPTIONS } from '@/lib/reportsFilterOptions'
import { RiskTrendChart } from '../charts'

const { Text } = Typography
const { RangePicker } = DatePicker

type WindowKey = 'today' | '7d' | '30d' | 'custom'

const WINDOW_SEGMENTS: { value: Exclude<WindowKey, 'custom'>; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

// Match the backend cap (see app.services.report_metrics.MAX_CUSTOM_WINDOW).
const MAX_RANGE_DAYS = 90

// 4 张 Statistic 卡片的固定顺序（按风险等级由低到高）。
const RISK_LEVEL_CARDS = [
  { key: 'none', label: '无风险', color: '#94A3B8' },
  { key: 'low', label: '低风险', color: '#16A34A' },
  { key: 'medium', label: '中风险', color: '#D97706' },
  { key: 'high', label: '高风险', color: '#DC2626' },
] as const

function shortDay(d: Dayjs): string {
  return d.format('MM.DD')
}

export default function TrendTab() {
  const [windowKey, setWindowKey] = useState<WindowKey>('7d')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [mediaTypes, setMediaTypes] = useState<DetectionModality[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  // 审核项 filter — UI 占位，后端聚合尚未接入。
  const [auditItemIds] = useState<number[]>([])
  const [riskPoints, setRiskPoints] = useState<RiskTimeseriesPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isCustom = windowKey === 'custom'
  const rangeValid = !!customRange && customRange[1].isAfter(customRange[0])

  // 媒体类型 与 素材类型 共用后端 material_types 入参（同一 enum，同一字段）。
  const combinedMaterialTypes = useMemo(() => {
    const set = new Set<string>([...mediaTypes, ...materialTypes])
    return Array.from(set)
  }, [mediaTypes, materialTypes])

  // 自定义窗口天数（用于风险趋势的 days 参数）。
  const days = useMemo(() => {
    if (isCustom && rangeValid && customRange) {
      return Math.max(customRange[1].diff(customRange[0], 'day') + 1, 1)
    }
    return windowKey === 'today' ? 1 : windowKey === '30d' ? 30 : 7
  }, [windowKey, customRange, isCustom, rangeValid])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)

    const materialTypesParam = combinedMaterialTypes.length
      ? combinedMaterialTypes
      : undefined

    reportsApi
      .riskTrend({ days, material_types: materialTypesParam })
      .then((rt) => {
        if (!alive) return
        setRiskPoints(rt.points)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [days, combinedMaterialTypes])

  // 4 张风险等级卡片：在窗口内把 4 个 level 的 count 求和，占比 = level_count / sum_of_4。
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

  const rangeLabel = useMemo(() => {
    if (isCustom && rangeValid && customRange) {
      return `${shortDay(customRange[0])} ~ ${shortDay(customRange[1])}`
    }
    return WINDOW_SEGMENTS.find((s) => s.value === windowKey)?.label ?? ''
  }, [isCustom, rangeValid, customRange, windowKey])

  const disabledDate = (current: Dayjs) => {
    const anchor = customRange?.[0]
    if (!anchor) return current.isAfter(dayjs().endOf('day'))
    const span = current.diff(anchor, 'day')
    return current.isAfter(dayjs().endOf('day')) || span > MAX_RANGE_DAYS
  }

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
          <Space size="small" align="center">
            <Text type="secondary">审核媒体类型</Text>
            <Select
              mode="multiple"
              allowClear
              value={mediaTypes}
              onChange={(v) => setMediaTypes(v as DetectionModality[])}
              options={DETECTION_MODALITIES}
              placeholder="全部"
              style={{ minWidth: 160 }}
              maxTagCount="responsive"
            />
          </Space>
          <Select
            mode="multiple"
            allowClear
            value={materialTypes}
            onChange={(v) => setMaterialTypes(v as MaterialType[])}
            options={MATERIAL_TYPE_OPTIONS}
            placeholder="素材类型"
            style={{ minWidth: 160 }}
            maxTagCount="responsive"
          />
          <Tooltip title="审核项维度后端聚合规划中">
            <Space size="small" align="center">
              <Text type="secondary">审核项</Text>
              <Select
                mode="multiple"
                disabled
                value={auditItemIds}
                options={[]}
                placeholder="规划中"
                style={{ minWidth: 120 }}
              />
            </Space>
          </Tooltip>
        </Space>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          口径: 占比 = 该风险等级条数 / 4 个等级条数之和; 自定义区间最长 {MAX_RANGE_DAYS} 天。
        </Text>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Row gutter={[16, 16]}>
        {RISK_LEVEL_CARDS.map((c) => {
          const count = riskTotals[c.key]
          const sum = riskTotals.none + riskTotals.low + riskTotals.medium + riskTotals.high
          const ratio = sum > 0 ? (count / sum) * 100 : 0
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

      <Card
        size="small"
        title={`风险等级分布 · ${rangeLabel}`}
        extra={<Text type="secondary">粒度: day</Text>}
      >
        <div style={{ height: 320 }}>
          <RiskTrendChart
            points={riskPoints}
            loading={loading}
            error={err}
            height={320}
          />
        </div>
      </Card>
    </Space>
  )
}
