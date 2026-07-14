import { useEffect, useMemo, useState } from 'react'
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
import { strategiesApi } from '@/api/strategies'
import type {
  QualityDetailRow,
  QualityResponse,
  MaterialType,
  MachineDecision,
} from '@/types/domain'
import {
  MATERIAL_TYPE_OPTIONS,
  MACHINE_DECISION_OPTIONS,
  QUALITY_VERDICT_OPTIONS,
} from '@/lib/reportsFilterOptions'
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
  const [materialType, setMaterialType] = useState<MaterialType | null>(null)
  const [machineDecision, setMachineDecision] = useState<MachineDecision | 'all'>('all')
  const [verdict, setVerdict] = useState<'all' | 'misjudge' | 'miss' | 'agree'>('all')
  const [strategies, setStrategies] = useState<{ code: string; name: string }[]>([])
  const [data, setData] = useState<QualityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    strategiesApi
      .list({ size: 100 })
      .then((page) => {
        setStrategies(
          page.items
            .filter((s) => s.is_active)
            .map((s) => ({ code: s.code, name: s.name })),
        )
      })
      .catch(() => setStrategies([]))
  }, [])

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

  const filtered = useMemo(() => {
    return (data?.detail ?? []).filter((r) => {
      if (materialType) {
        const mt = (r as unknown as { material_type?: string }).material_type
        if (mt && mt !== materialType) return false
      }
      if (machineDecision !== 'all' && r.machine_decision !== machineDecision) return false
      if (verdict !== 'all' && r.verdict !== verdict) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        String(r.task_id).includes(q) ||
        (r.strategy_code ?? '').toLowerCase().includes(q) ||
        (r.feedback ?? '').toLowerCase().includes(q)
      )
    })
  }, [data?.detail, materialType, machineDecision, verdict, search])

  const strategyOptions = useMemo(
    () => [
      { value: '', label: '全部策略' },
      ...strategies.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
    ],
    [strategies],
  )

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
          <Select
            value={strategyCode ?? ''}
            onChange={(v) => setStrategyCode(v ? v : null)}
            options={strategyOptions}
            placeholder="全部策略"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 220 }}
          />
          <Text type="secondary">素材</Text>
          <Select
            value={materialType ?? ''}
            onChange={(v) => setMaterialType(v ? (v as MaterialType) : null)}
            options={[{ value: '', label: '全部' }, ...MATERIAL_TYPE_OPTIONS]}
            placeholder="全部"
            allowClear
            style={{ minWidth: 120 }}
          />
          <Text type="secondary">机审结果</Text>
          <Select
            value={machineDecision}
            onChange={setMachineDecision}
            options={MACHINE_DECISION_OPTIONS}
            style={{ minWidth: 120 }}
          />
          <Text type="secondary">判定</Text>
          <Select
            value={verdict}
            onChange={(v) => setVerdict(v as typeof verdict)}
            options={QUALITY_VERDICT_OPTIONS}
            style={{ minWidth: 160 }}
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
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          本指标基于人工抽检样本(非全量), verdicts.total = 样本量;
          误判=机器漏放, 漏判=机器误杀, 一致=机人一致;
          素材维度后端暂未提供 material_type 字段, 当前为预留 UI。
        </Text>
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
            title="Top 退回审核点"
            color="#DC2626"
            loading={loading}
            error={err}
          />
        </Col>
        <Col xs={24} md={12}>
          <TagPieChart
            data={data?.top_false_positive_tags ?? []}
            title="Top 误判审核点"
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
