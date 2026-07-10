import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Col,
  Empty,
  message,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag as AntTag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { reportsApi, alertsApi } from '@/api/reports'
import type { AlertEventOut, AnomalyResponse } from '@/types/domain'
import { MultiMetricLineChart } from '../charts'

const { Text } = Typography

const WINDOW_OPTIONS = [
  { value: '1h', label: '近 1 小时' },
  { value: '24h', label: '近 24 小时' },
]

const STATUS_OPTIONS = [
  { value: 'open', label: '待处理' },
  { value: 'acknowledged', label: '已确认' },
  { value: 'all', label: '全部' },
]

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  warn: 'orange',
  info: 'blue',
}

const RULE_LABEL: Record<string, string> = {
  reject_rate_spike: '拒绝率突升',
  high_risk_concentration: '高风险账号聚集',
  submit_drop: '提交量骤降',
}

export default function AnomalyTab() {
  const [window, setWindow] = useState('1h')
  const [status, setStatus] = useState<'open' | 'acknowledged' | 'all'>('open')
  const [anomaly, setAnomaly] = useState<AnomalyResponse | null>(null)
  const [alerts, setAlerts] = useState<AlertEventOut[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [acking, setAcking] = useState<number | null>(null)

  const refresh = async (win: string, st: typeof status) => {
    setLoading(true)
    setErr(null)
    try {
      const [a, l] = await Promise.all([
        reportsApi.anomaly(win),
        alertsApi.list({ status: st, limit: 50 }),
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
    void refresh(window, status)
  }, [window, status])

  const handleAck = async (id: number, note: string) => {
    setAcking(id)
    try {
      await alertsApi.ack(id, note)
      message.success('已确认')
      await refresh(window, status)
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setAcking(null)
    }
  }

  const alertColumns: ColumnsType<AlertEventOut> = [
    {
      title: '规则',
      dataIndex: 'rule_code',
      width: 180,
      render: (v: string) => RULE_LABEL[v] ?? v,
    },
    {
      title: '严重度',
      dataIndex: 'severity',
      width: 100,
      render: (v: string) => (
        <AntTag color={SEVERITY_COLOR[v] ?? 'default'}>{v.toUpperCase()}</AntTag>
      ),
    },
    {
      title: '指标',
      dataIndex: 'metric',
      width: 140,
    },
    {
      title: '观测值',
      dataIndex: 'observed_value',
      width: 110,
      render: (v: number, row) => (
        <span>
          {v.toFixed(2)} <Text type="secondary">/ {row.threshold.toFixed(2)}</Text>
        </span>
      ),
    },
    {
      title: '窗口',
      dataIndex: 'window_start',
      width: 240,
      render: (_v: string, row) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.window_start.slice(0, 16).replace('T', ' ')} ~ {row.window_end.slice(11, 16)}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) =>
        v === 'open' ? (
          <Badge status="processing" text="待处理" />
        ) : (
          <Badge status="success" text="已确认" />
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_v, row) =>
        row.status === 'open' ? (
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
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.ack_note ?? '-'}
          </Text>
        ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Text type="secondary">监控窗</Text>
          <Select
            value={window}
            onChange={setWindow}
            options={WINDOW_OPTIONS}
            style={{ minWidth: 140 }}
          />
          <Text type="secondary">报警状态</Text>
          <Select
            value={status}
            onChange={(v) => setStatus(v as 'open' | 'acknowledged' | 'all')}
            options={STATUS_OPTIONS}
            style={{ minWidth: 120 }}
          />
          <Button onClick={() => void refresh(window, status)}>刷新</Button>
        </Space>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Card size="small" title={`实时指标 · ${WINDOW_OPTIONS.find((w) => w.value === window)?.label ?? ''}`}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title="当前拒绝率"
              value={anomaly?.current.reject_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#DC2626' }}
            />
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
          <Col xs={12} md={6}>
            <Statistic
              title="提交量 / 高风险账号"
              value={anomaly?.current.submitted ?? 0}
              suffix={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {' '}
                  / {anomaly?.current.high_risk_accounts ?? 0}
                </Text>
              }
              valueStyle={{ color: '#2563EB' }}
            />
          </Col>
        </Row>
        <div style={{ height: 320, marginTop: 16 }}>
          <MultiMetricLineChart
            series={anomaly?.series ?? []}
            loading={loading}
            error={err}
            height={320}
          />
        </div>
      </Card>

      <Card size="small" title="报警事件">
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
    </Space>
  )
}
