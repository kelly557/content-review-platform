import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  message,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag as AntTag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { SettingOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { reportsApi, alertsApi } from '@/api/reports'
import type {
  AlertEventOut,
  AnomalyQuery,
  AnomalyResponse,
  AnomalyWindow,
  AuditModality,
  RiskTrendOptionsResponse,
} from '@/types/domain'
import { AUDIT_MODALITIES } from '@/types/domain'
import { useAnomalyThresholds } from '@/hooks/useAnomalyThresholds'
import {
  ANOMALY_RULE_CODES,
} from '@/lib/anomalyThresholds'
import AnomalyRulesDrawer from './AnomalyRulesDrawer'
import AlertEventDetailDrawer from './AlertEventDetailDrawer'
import RiskLabelCascade from '@/components/query/RiskLabelCascade'
import { MultiMetricLineChart } from '../charts'
import {
  formatObserved,
  formatPublicId,
  formatRuleCode,
  formatSeverity,
  formatStatus,
  formatTriggerTime,
  formatWindow,
} from '@/lib/alertHelpers'

const { Text } = Typography
const { RangePicker } = DatePicker

const WINDOW_SEGMENTS: { value: AnomalyWindow; label: string }[] = [
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 日' },
]

const GRANULARITY_SEGMENTS: { value: 'hour' | 'day'; label: string }[] = [
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
]

// 与后端 app.services.report_metrics.MAX_CUSTOM_WINDOW 一致
const MAX_RANGE_DAYS = 90

const RULE_LABEL: Record<string, string> = {
  reject_rate_spike: '拒绝率突升',
  high_risk_concentration: '高风险账号聚集',
  submit_drop: '提交量骤降',
  reject_rate_high: '拒绝率异常',
  high_risk_content_high: '账号高风险阻断异常',
  high_risk_account_concentration: '高风险账号聚集异常',
}

function shortDay(d: Dayjs): string {
  return d.format('MM.DD')
}

export default function AnomalyTab() {
  const [windowKey, setWindowKey] = useState<AnomalyWindow>('1h')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [modalities, setModalities] = useState<AuditModality[]>([])
  const [strategyCodes, setStrategyCodes] = useState<string[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [ips, setIps] = useState<string[]>([])
  const [riskLabelPaths, setRiskLabelPaths] = useState<string[]>([])
  const [granularity, setGranularity] = useState<'hour' | 'day' | null>(null)
  const [anomaly, setAnomaly] = useState<AnomalyResponse | null>(null)
  const [alerts, setAlerts] = useState<AlertEventOut[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [acking, setAcking] = useState<number | null>(null)
  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'open' | 'acknowledged' | 'all'>('open')
  const [detailAlert, setDetailAlert] = useState<AlertEventOut | null>(null)
  const [options, setOptions] = useState<RiskTrendOptionsResponse | null>(null)
  const { thresholds } = useAnomalyThresholds()

  const thresholdBy = (code: string) => thresholds.find((t) => t.rule_code === code)
  const tReject = thresholdBy(ANOMALY_RULE_CODES.REJECT_RATE)

  const isCustom = !!customRange
  const rangeValid = !!customRange && customRange[1].isAfter(customRange[0])

  // 拉取筛选项（每个会话拉一次）。与 TrendTab 共用 risk-trend/options，
  // 因为里面已经给出审核模态 + 策略 + 渠道 + 账号 + IP + 风险标签树。
  useEffect(() => {
    let alive = true
    reportsApi
      .riskTrendOptions()
      .then((opt) => {
        if (alive) setOptions(opt)
      })
      .catch(() => {
        if (alive) setOptions(null)
      })
    return () => {
      alive = false
    }
  }, [])

  const refresh = async () => {
    setLoading(true)
    setErr(null)
    try {
      const query: AnomalyQuery = {
        modalities: modalities.length ? modalities : undefined,
        strategy_codes: strategyCodes.length ? strategyCodes : undefined,
        channels: channels.length ? channels : undefined,
        account_ids: accountIds.length ? accountIds : undefined,
        ips: ips.length ? ips : undefined,
        risk_label_paths: riskLabelPaths.length ? riskLabelPaths : undefined,
        granularity: granularity ?? undefined,
      }
      if (isCustom && rangeValid && customRange) {
        query.start = customRange[0].startOf('day').toISOString()
        query.end = customRange[1].endOf('day').toISOString()
      } else {
        query.window = windowKey
      }
      const [a, l] = await Promise.all([
        reportsApi.anomaly(query),
        alertsApi.list({
          ...query,
          status: statusFilter,
        }),
      ])
      setAnomaly(a)
      setAlerts(l.items)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    windowKey,
    customRange,
    modalities,
    strategyCodes,
    channels,
    accountIds,
    ips,
    riskLabelPaths,
    granularity,
    statusFilter,
  ])

  const handleAck = async (id: number, note: string) => {
    setAcking(id)
    try {
      await alertsApi.ack(id, note)
      await refresh()
      message.success('已确认')
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setAcking(null)
    }
  }

  const bucketLabel = useMemo(() => {
    if (isCustom && rangeValid && customRange) {
      return `${shortDay(customRange[0])} ~ ${shortDay(customRange[1])}`
    }
    return WINDOW_SEGMENTS.find((w) => w.value === windowKey)?.label ?? ''
  }, [isCustom, rangeValid, customRange, windowKey])

  const effectiveGranularity = useMemo<'hour' | 'day'>(() => {
    if (granularity) return granularity
    if (windowKey === '1h') return 'hour'
    return 'day'
  }, [granularity, windowKey])

  const disabledDate = (current: Dayjs) => {
    const anchor = customRange?.[0]
    if (!anchor) return current.isAfter(dayjs().endOf('day'))
    const span = current.diff(anchor, 'day')
    return current.isAfter(dayjs().endOf('day')) || span > MAX_RANGE_DAYS
  }

  const alertColumns: ColumnsType<AlertEventOut> = [
    {
      title: '事件码',
      key: 'public_id',
      width: 180,
      render: (_v, row) => (
        <Text
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}
          copyable={!!row.public_id}
        >
          {formatPublicId(row.public_id ?? '')}
        </Text>
      ),
    },
    {
      title: '规则',
      dataIndex: 'rule_code',
      width: 200,
      render: (v: string) => (
        <Tooltip title={formatRuleCode(v)}>
          <Text strong>{RULE_LABEL[v] ?? v}</Text>
        </Tooltip>
      ),
    },
    {
      title: '严重度',
      dataIndex: 'severity',
      width: 90,
      render: (v: string) => {
        const { color, label } = formatSeverity(v)
        return <AntTag color={color}>{label}</AntTag>
      },
    },
    {
      title: '触发时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => (
        <Text style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
          {formatTriggerTime(v)}
        </Text>
      ),
    },
    {
      title: '触发窗口',
      key: 'window',
      width: 220,
      render: (_v, row) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatWindow(row.window_start, row.window_end)}
        </Text>
      ),
    },
    {
      title: '观测值',
      key: 'observed',
      width: 130,
      render: (_v, row) => (
        <Text style={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
          {formatObserved(row.observed_value, row.threshold)}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) =>
        v === 'open' ? (
          <Badge status="processing" text={formatStatus(v)} />
        ) : (
          <Badge status="success" text={formatStatus(v)} />
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_v, row) => (
        <Space size="small">
          <Button
            size="small"
            type="link"
            onClick={() => setDetailAlert(row)}
          >
            详情
          </Button>
          {row.status === 'open' && (
            <Popconfirm
              title="确认该报警?"
              description="将标记为已处理并记录处置人"
              okText="确认"
              cancelText="取消"
              onConfirm={() => void handleAck(row.id, '已确认')}
            >
              <Button size="small" type="link" loading={acking === row.id}>
                确认
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const filterBar = (
    <Card size="small">
      <Space wrap size="middle" align="center">
        <Segmented
          value={windowKey}
          onChange={(v) => {
            setWindowKey(v as AnomalyWindow)
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
            if (next) setWindowKey('7d')
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
          value={channels}
          onChange={(v) => setChannels(v as string[])}
          options={options?.channels ?? []}
          placeholder="渠道"
          style={{ minWidth: 140 }}
          maxTagCount="responsive"
        />
        <Select
          mode="multiple"
          allowClear
          value={accountIds}
          onChange={(v) => setAccountIds(v as string[])}
          options={options?.account_ids ?? []}
          placeholder="account id"
          style={{ minWidth: 160 }}
          maxTagCount="responsive"
        />
        <Select
          mode="tags"
          allowClear
          value={ips}
          onChange={(v) => setIps(v as string[])}
          options={options?.ips ?? []}
          placeholder="ip"
          style={{ minWidth: 160 }}
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
        <Button onClick={() => void refresh()}>刷新</Button>
      </Space>
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          阈值参考: 拒绝率 ≥ {tReject?.threshold ?? 0}%; 自定义区间最长 {MAX_RANGE_DAYS} 天。
        </Text>
      </div>
    </Card>
  )

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {filterBar}

      <AnomalyRulesDrawer
        open={rulesDrawerOpen}
        onClose={() => setRulesDrawerOpen(false)}
      />

      {err && <Text type="danger">{err}</Text>}

      <Card
        size="small"
        title={`实时指标 · ${bucketLabel}`}
        extra={
          <Space size="small" align="center">
            <Tooltip title="按小时切分可看细致的突跳; 按天适合长周期 (24h / 7d) 趋势">
              <Text type="secondary">颗粒度</Text>
            </Tooltip>
            <Segmented
              value={granularity ?? '__auto'}
              onChange={(v) =>
                setGranularity(v === '__auto' ? null : (v as 'hour' | 'day'))
              }
              options={[
                { value: '__auto', label: '自动' },
                ...GRANULARITY_SEGMENTS,
              ]}
            />
            <Tooltip title="监测规则配置">
              <Button
                icon={<SettingOutlined />}
                onClick={() => setRulesDrawerOpen(true)}
              >
                监测规则配置
              </Button>
            </Tooltip>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title={`当前拒绝率 (阈值 ${tReject?.threshold ?? 0}%)`}
              value={anomaly?.current.reject_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{
                color:
                  (anomaly?.current.reject_rate ?? 0) >= (tReject?.threshold ?? 0)
                    ? '#DC2626'
                    : '#475569',
              }}
            />
            <Text
              type={
                (anomaly?.current.reject_rate ?? 0) >= (tReject?.threshold ?? 0)
                  ? 'danger'
                  : 'secondary'
              }
              style={{ fontSize: 11 }}
            >
              {(anomaly?.current.reject_rate ?? 0) >= (tReject?.threshold ?? 0)
                ? `已超阈值 (${tReject?.threshold ?? 0}%)`
                : `正常 (阈值 ${tReject?.threshold ?? 0}%)`}
            </Text>
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="当前审核率"
              value={anomaly?.current.review_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#D97706' }}
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="当前通过率"
              value={anomaly?.current.approve_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#16A34A' }}
            />
          </Col>
        </Row>
        <div style={{ height: 320, marginTop: 16 }}>
          <MultiMetricLineChart
            series={anomaly?.series ?? []}
            loading={loading}
            error={err}
            height={320}
            granularity={effectiveGranularity}
          />
        </div>
      </Card>

      <Card
        size="small"
        title="报警事件"
        extra={
          <Segmented
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as 'open' | 'acknowledged' | 'all')}
            options={[
              { value: 'open', label: '待处理' },
              { value: 'acknowledged', label: '已确认' },
              { value: 'all', label: '全部' },
            ]}
          />
        }
      >
        {alerts.length === 0 ? (
          <Empty description="暂无报警" />
        ) : (
          <Table
            rowKey="id"
            dataSource={alerts}
            columns={alertColumns}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Card>

      <AlertEventDetailDrawer
        open={!!detailAlert}
        alertId={detailAlert?.id ?? null}
        ruleCode={detailAlert?.rule_code}
        ruleLabel={detailAlert?.rule_code ? RULE_LABEL[detailAlert.rule_code] : undefined}
        observedValue={detailAlert?.observed_value}
        threshold={detailAlert?.threshold}
        windowStart={detailAlert?.window_start}
        windowEnd={detailAlert?.window_end}
        status={detailAlert?.status}
        onClose={() => setDetailAlert(null)}
      />
    </Space>
  )
}
