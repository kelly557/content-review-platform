import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag as AntTag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DownloadOutlined as DownloadIcon } from '@ant-design/icons'
import { reportsApi } from '@/api/reports'
import type { QualityDetailRow, QualityResponse } from '@/types/domain'
import { ReasonBarChart, TagPieChart } from '../charts'

const { Text } = Typography

const WINDOW_OPTIONS = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const VERDICT_COLOR: Record<string, string> = {
  misjudge: 'red',
  miss: 'orange',
  agree: 'green',
}

const VERDICT_LABEL: Record<string, string> = {
  misjudge: '误判',
  miss: '漏判',
  agree: '一致',
}

export default function QualityTab() {
  const [window, setWindow] = useState('7d')
  const [strategyCode, setStrategyCode] = useState<string | null>(null)
  const [data, setData] = useState<QualityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    reportsApi
      .quality({ window, strategy_code: strategyCode ?? undefined, limit: 200 })
      .then((res) => {
        if (!alive) return
        setData(res)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [window, strategyCode])

  const filtered = (data?.detail ?? []).filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(r.task_id).includes(q) ||
      (r.strategy_code ?? '').toLowerCase().includes(q) ||
      (r.feedback ?? '').toLowerCase().includes(q)
    )
  })

  const detailColumns: ColumnsType<QualityDetailRow> = [
    { title: 'Task ID', dataIndex: 'task_id', width: 90 },
    { title: 'Material ID', dataIndex: 'material_id', width: 110 },
    { title: '策略', dataIndex: 'strategy_code', width: 130 },
    {
      title: '机审',
      dataIndex: 'machine_decision',
      width: 90,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '人审',
      dataIndex: 'human_decision',
      width: 90,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '判定',
      dataIndex: 'verdict',
      width: 90,
      render: (v: string) => (
        <AntTag color={VERDICT_COLOR[v] ?? 'default'}>{VERDICT_LABEL[v] ?? v}</AntTag>
      ),
    },
    {
      title: '反馈',
      dataIndex: 'feedback',
      ellipsis: true,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '完成时间',
      dataIndex: 'completed_at',
      width: 170,
      render: (v: string | null) => (v ? v.slice(0, 16).replace('T', ' ') : '-'),
    },
  ]

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
          <Text type="secondary">策略</Text>
          <Input
            value={strategyCode ?? ''}
            onChange={(e) => setStrategyCode(e.target.value || null)}
            placeholder="按策略 code 过滤 (可选)"
            allowClear
            style={{ minWidth: 220 }}
          />
          <Button
            icon={<DownloadIcon />}
            href={reportsApi.qualityExportUrl({ window, strategy_code: strategyCode ?? undefined })}
            target="_blank"
            rel="noreferrer"
          >
            导出 CSV
          </Button>
        </Space>
      </Card>

      {err && <Text type="danger">{err}</Text>}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="误判率 (机器漏放)"
              value={data?.misjudge_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#DC2626' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data?.verdicts.misjudge ?? 0} / {data?.verdicts.total ?? 0}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="漏判率 (机器误杀)"
              value={data?.miss_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#D97706' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data?.verdicts.miss ?? 0} / {data?.verdicts.total ?? 0}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="机人一致率"
              value={data?.agree_rate ?? 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: '#16A34A' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="复盘任务数" value={data?.verdicts.total ?? 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <ReasonBarChart
            data={data?.top_rejection_reasons ?? []}
            title="Top 退回原因"
            color="#DC2626"
            loading={loading}
            error={err}
          />
        </Col>
        <Col xs={24} md={12}>
          <TagPieChart
            data={data?.top_false_positive_tags ?? []}
            title="Top 误判标签"
            loading={loading}
            error={err}
          />
        </Col>
      </Row>

      <Card
        size="small"
        title={`复盘明细 (${filtered.length} / ${data?.detail_total ?? 0})`}
        extra={
          <Input.Search
            placeholder="搜索 task / 策略 / 反馈"
            allowClear
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
        }
      >
        {filtered.length === 0 ? (
          <Empty description="暂无复盘数据" />
        ) : (
          <Table
            rowKey="task_id"
            dataSource={filtered}
            columns={detailColumns}
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Card>
    </Space>
  )
}
