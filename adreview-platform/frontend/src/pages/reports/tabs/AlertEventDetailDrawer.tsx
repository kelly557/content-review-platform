import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Descriptions,
  Drawer,
  Empty,
  Progress,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import type {
  AlertRootCauseAccount,
  AlertRootCauseAccountIP,
  AlertRootCauseResponse,
  AlertRootCauseTopRiskLabel,
} from '@/types/domain'
import { alertsApi, type MockMode } from '@/api/reports'
import { useAnomalyThresholds } from '@/hooks/useAnomalyThresholds'
import {
  formatExtraConditions,
  formatObserved,
  formatPublicId,
  formatRuleCode,
  formatSeverity,
  formatStatus,
  formatWindow,
} from '@/lib/alertHelpers'

const { Text, Title } = Typography

interface Props {
  open: boolean
  alertId: number | null
  ruleCode?: string
  observedValue?: number
  threshold?: number
  /** 来自列表的 window_start / window_end, 直接展示 */
  windowStart?: string
  windowEnd?: string
  status?: 'open' | 'acknowledged'
  ruleLabel?: string
  mock?: MockMode
  onClose: () => void
}

export default function AlertEventDetailDrawer({
  open,
  alertId,
  ruleCode,
  observedValue,
  threshold,
  windowStart,
  windowEnd,
  status,
  ruleLabel,
  mock,
  onClose,
}: Props) {
  const [data, setData] = useState<AlertRootCauseResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || alertId == null) return
    let alive = true
    setLoading(true)
    setErr(null)
    setData(null)
    alertsApi
      .detail(alertId, { ruleCode }, mock)
      .then((rc) => {
        if (alive) setData(rc)
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, alertId, ruleCode, mock])

  const sev = formatSeverity(ruleCode ? data?.rule_code ?? '' : 'info')
  void sev

  const { thresholds } = useAnomalyThresholds()
  const currentRule = thresholds.find((t) => t.rule_code === (data?.rule_code ?? ruleCode))
  const extraConditionsText = formatExtraConditions(currentRule?.extra_conditions)

  const displayRuleLabel = ruleLabel ?? data?.rule_label ?? formatRuleCode(ruleCode ?? '')
  const displayPublicId = formatPublicId(data?.alert_id != null ? `ALERT-${data.alert_id}` : '')
  const displayWindowInfo = data
    ? formatWindow(data.window.start, data.window.end)
    : windowStart && windowEnd
      ? formatWindow(windowStart, windowEnd)
      : ''
  const displayObserved = observedValue != null && threshold != null
    ? formatObserved(observedValue, threshold, currentRule?.unit)
    : '—'

  return (
    <Drawer
      title="报警事件详情"
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {err && <Alert type="error" message={err} style={{ marginBottom: 16 }} />}

      {/* 1. 事件快照 */}
      <Descriptions
        title="事件快照"
        column={1}
        size="small"
        bordered
        style={{ marginBottom: 24 }}
      >
        <Descriptions.Item label="事件码">
          <Text code>{displayPublicId}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="规则">
          <Space>
            <Text strong>{displayRuleLabel}</Text>
            {data?.rule_code && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                ({data.rule_code})
              </Text>
            )}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          {(() => {
            const s = formatStatus(data?.alert_id != null ? (status ?? 'open') : 'open')
            const badge = s === '已确认' ? 'success' : 'processing'
            return <Badge status={badge} text={s} />
          })()}
        </Descriptions.Item>
        <Descriptions.Item label="触发窗口">
          {displayWindowInfo || '—'}
        </Descriptions.Item>
        <Descriptions.Item label="观测值 / 阈值">
          {displayObserved}
        </Descriptions.Item>
        <Descriptions.Item label="附加条件">
          {extraConditionsText ? (
            <Text
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {extraConditionsText}
            </Text>
          ) : (
            <Text type="secondary">—</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="触发维度">
          {data?.dimension ? (
            <Space wrap>
              {data.dimension.modality && <Tag>模态: {data.dimension.modality}</Tag>}
              {data.dimension.strategy_code && (
                <Tag color="blue">策略: {data.dimension.strategy_code}</Tag>
              )}
              {data.dimension.channel && (
                <Tag color="purple">渠道: {data.dimension.channel}</Tag>
              )}
              {!data.dimension.modality && !data.dimension.strategy_code && !data.dimension.channel && (
                <Text type="secondary">未指定</Text>
              )}
            </Space>
          ) : (
            <Text type="secondary">—</Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      {/* 2. Root Cause */}
      <Title level={5} style={{ marginBottom: 12 }}>
        Root Cause
      </Title>

      {loading && <Skeleton active paragraph={{ rows: 4 }} />}

      {!loading && data && (
        <RootCauseSection
          ruleCode={data.rule_code}
          topRiskLabels={data.top_risk_labels}
          topAccounts={data.top_accounts}
          topAccountIps={data.top_account_ips}
        />
      )}

      {!loading && !data && <Empty description="暂无根因数据" />}
    </Drawer>
  )
}

function RootCauseSection({
  ruleCode,
  topRiskLabels,
  topAccounts,
  topAccountIps,
}: {
  ruleCode: string
  topRiskLabels: AlertRootCauseTopRiskLabel[]
  topAccounts: AlertRootCauseAccount[]
  topAccountIps: AlertRootCauseAccountIP[]
}) {
  if (ruleCode === 'reject_rate_high') {
    return <TopRiskLabelsPanel items={topRiskLabels} />
  }
  if (ruleCode === 'high_risk_content_high') {
    return <TopAccountsPanel items={topAccounts} />
  }
  if (ruleCode === 'high_risk_account_concentration') {
    return <TopAccountIPsPanel items={topAccountIps} />
  }
  return (
    <Empty
      description={
        <Space direction="vertical" size={4}>
          <Text>该规则未配置 Root Cause 视图</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            规则 {ruleCode} 不在 ROOT_CAUSE_RULES 映射中
          </Text>
        </Space>
      }
    />
  )
}

function TopRiskLabelsPanel({ items }: { items: AlertRootCauseTopRiskLabel[] }) {
  if (items.length === 0) {
    return <Empty description="近窗口内未查询到风险标签" />
  }
  const max = Math.max(...items.map((r) => r.count), 1)
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        按触发次数倒序排列
      </Text>
      {items.map((r) => (
        <div key={r.label} style={{ marginBottom: 12 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>{r.label}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.count} 次
            </Text>
          </Space>
          <Progress
            percent={Math.round((r.count / max) * 100)}
            showInfo={false}
            strokeColor="#DC2626"
            size="small"
          />
        </div>
      ))}
    </div>
  )
}

function TopAccountsPanel({ items }: { items: AlertRootCauseAccount[] }) {
  if (items.length === 0) {
    return <Empty description="近窗口内未查询到高阻断账号" />
  }
  return (
    <Table
      rows={items.map((a, i) => ({
        key: `${a.account_id}-${i}`,
        rank: i + 1,
        account_id: a.account_id,
        submitted: a.submitted,
        rejected: a.rejected,
        reject_rate: a.submitted > 0 ? ((a.rejected / a.submitted) * 100).toFixed(1) : '0.0',
      }))}
      columns={[
        { key: 'rank', title: '#', width: 50 },
        { key: 'account_id', title: '账号' },
        { key: 'submitted', title: '提交', width: 80 },
        { key: 'rejected', title: '驳回', width: 80 },
        {
          key: 'reject_rate',
          title: '驳回率',
          width: 100,
          render: (v: unknown) => <Tag color="red">{String(v)}%</Tag>,
        },
      ]}
    />
  )
}

function TopAccountIPsPanel({ items }: { items: AlertRootCauseAccountIP[] }) {
  if (items.length === 0) {
    return <Empty description="近窗口内未查询到账号-IP 关联" />
  }
  return (
    <Table
      rows={items.map((a, i) => ({
        key: `${a.account_id}-${a.ip}-${i}`,
        account_id: a.account_id,
        ip: a.ip,
        submitted: a.submitted,
        rejected: a.rejected,
        reject_rate: a.submitted > 0 ? ((a.rejected / a.submitted) * 100).toFixed(1) : '0.0',
      }))}
      columns={[
        { key: 'account_id', title: '账号' },
        { key: 'ip', title: 'IP' },
        { key: 'submitted', title: '提交', width: 80 },
        { key: 'rejected', title: '驳回', width: 80 },
        {
          key: 'reject_rate',
          title: '驳回率',
          width: 100,
          render: (v: unknown) => <Tag color="red">{String(v)}%</Tag>,
        },
      ]}
    />
  )
}

// Inline minimal table primitive (avoid pulling in another antd dep).
function Table({
  rows,
  columns,
}: {
  rows: Array<Record<string, unknown>>
  columns: Array<{
    key: string
    title: string
    width?: number
    render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode
  }>
}) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
      }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{
                padding: '8px 6px',
                textAlign: 'left',
                width: c.width,
                fontWeight: 500,
                color: '#475569',
              }}
            >
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key as string} style={{ borderBottom: '1px solid #f1f5f9' }}>
            {columns.map((c) => (
              <td key={c.key} style={{ padding: '8px 6px' }}>
                {c.render
                  ? c.render(r[c.key], r)
                  : (r[c.key] as React.ReactNode)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
