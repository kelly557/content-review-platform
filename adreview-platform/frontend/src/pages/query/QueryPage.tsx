import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Space,
  Table,
  Tag,
  Tooltip,
  type MenuProps,
  type TableColumnsType,
} from 'antd'
import {
  CloudDownloadOutlined,
  DownOutlined,
  FilterOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { queryApi } from '@/api/query'
import {
  DECISION_LABELS,
  DETECTION_MODALITIES,
  MACHINE_DECISION_OPTIONS,
  MACHINE_REVIEW_FEEDBACK_OPTIONS,
  QUERY_COLUMNS,
  type MachineHit,
  type MachineReviewFeedbackKind,
  type MachineReviewRecord,
  type QueryColumnKey,
  type QueryFilters,
  type RiskTaxonomyNode,
} from '@/types/domain'
import { loadVisibleColumns, saveVisibleColumns } from '@/lib/queryColumnPrefs'
import FilterBar from '@/components/query/FilterBar'
import ColumnSettingsMenu from '@/components/query/ColumnSettingsMenu'
import RecordDetailDrawer from '@/components/query/RecordDetailDrawer'
import ContentPreviewCell from '@/components/query/ContentPreviewCell'

const decisionMeta = (v?: string | null) => MACHINE_DECISION_OPTIONS.find((m) => m.value === v)

function ColumnTitle({ text, tip }: { text: string; tip?: string }) {
  if (!tip) return text
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {text}
      <Tooltip title={tip} placement="top">
        <QuestionCircleOutlined style={{ color: '#94A3B8', fontSize: 12, cursor: 'help' }} />
      </Tooltip>
    </span>
  )
}

function renderUuidCell(uuid: string | null | undefined, fallback?: string | number | null) {
  if (uuid) {
    return (
      <Tooltip title={uuid}>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {uuid.slice(0, 8)}…
        </span>
      </Tooltip>
    )
  }
  return fallback != null ? String(fallback) : '-'
}

const FEEDBACK_LABEL: Record<MachineReviewFeedbackKind, string> = {
  false_positive: '未违规误报',
  false_negative: '违规漏报',
}

const FEEDBACK_COLOR: Record<MachineReviewFeedbackKind, string> = {
  false_positive: 'orange',
  false_negative: 'purple',
}

function feedbackLabel(v?: string | null) {
  if (!v) return ''
  return FEEDBACK_LABEL[v as MachineReviewFeedbackKind] ?? ''
}

function riskLabelPath(h: MachineHit): string {
  const cat = h.risk_category_label || ''
  const item = h.audit_item_label || ''
  const point = h.label_cn || h.label || ''
  return [cat, item, point].filter(Boolean).join(' / ')
}

export default function QueryPage() {
  const { message } = App.useApp()

  const [filters, setFilters] = useState<QueryFilters>({})
  const [submittedFilters, setSubmittedFilters] = useState<QueryFilters>({})
  const [items, setItems] = useState<MachineReviewRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [riskTaxonomy, setRiskTaxonomy] = useState<RiskTaxonomyNode[]>([])
  const [visibleColumns, setVisibleColumns] = useState<QueryColumnKey[]>(() =>
    loadVisibleColumns(),
  )
  const [detailRecord, setDetailRecord] = useState<MachineReviewRecord | null>(null)

  useEffect(() => {
    saveVisibleColumns(visibleColumns)
  }, [visibleColumns])

  const fetchTaxonomy = useCallback(async () => {
    try {
      const res = await queryApi.riskTaxonomy()
      setRiskTaxonomy(res.items ?? [])
    } catch {
      setRiskTaxonomy([])
    }
  }, [])

  useEffect(() => {
    fetchTaxonomy()
  }, [fetchTaxonomy])

  const fetchResults = useCallback(async () => {
    setLoading(true)
    try {
      const data = await queryApi.results({ ...submittedFilters, page, size })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      message.error('加载结果失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [submittedFilters, page, size, message])

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  const onSearch = () => {
    setPage(1)
    setSubmittedFilters({ ...filters })
  }

  const onReset = () => {
    setFilters({})
    setSubmittedFilters({})
    setPage(1)
  }

  const exportHref = useMemo(() => queryApi.exportCsvUrl(submittedFilters), [submittedFilters])

  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns])

  const columnsAll: TableColumnsType<MachineReviewRecord> = [
    {
      title: <ColumnTitle text="素材内容" tip="素材内容预览：文本摘要 / 图片缩略图 / 音视频入口，点击查看完整" />,
      key: 'content_preview',
      width: 280,
      fixed: 'left',
      render: (_, r) => <ContentPreviewCell record={r} onPreview={setDetailRecord} />,
    },
    {
      title: '策略名称',
      key: 'strategy_name',
      width: 180,
      render: (_, r) => r.strategy_name || r.strategy_code || '-',
    },
    {
      title: <ColumnTitle text="审核结果" tip="机审最终判定：阻断 / 复核 / 通过" />,
      key: 'machine_decision',
      width: 110,
      render: (_, r) => {
        const meta = decisionMeta(r.machine_decision)
        if (!meta) return '-'
        return <Tag color={meta.color}>{meta.label}</Tag>
      },
    },
    {
      title: <ColumnTitle text="反馈结果" tip="最近一次反馈：违规漏报 / 未违规误报；无反馈时为空" />,
      key: 'feedback',
      width: 130,
      render: (_, r) => {
        const fb = r.last_feedback
        if (!fb) return '-'
        return <Tag color={FEEDBACK_COLOR[fb.kind]}>{feedbackLabel(fb.kind)}</Tag>
      },
    },
    {
      title: <ColumnTitle text="审核模态" tip="审核通道类型：指请求走的是文本/图片/视频/文件哪条审核链路" />,
      key: 'material_type',
      width: 110,
      render: (_, r) => {
        const meta = DETECTION_MODALITIES.find((m) => m.value === r.material_type)
        if (!meta) return '-'
        return <Tag color="geekblue">{meta.label}</Tag>
      },
    },
    {
      title: <ColumnTitle text="渠道" tip="业务侧写入的渠道标识" />,
      key: 'channel',
      width: 110,
      render: (_, r) => r.channel || '-',
    },
    {
      title: 'Request ID',
      key: 'request_id',
      width: 110,
      render: (_, r) => renderUuidCell(r.public_id, r.id),
    },
    {
      title: 'Task ID',
      key: 'task_id',
      width: 110,
      render: (_, r) => renderUuidCell(r.material_version_public_id, r.material_version_id),
    },
    {
      title: <ColumnTitle text="风险标签" tip="三级路径：风险类型 / 审核项 / 审核点" />,
      key: 'labels',
      render: (_, r) => {
        if (!r.hits?.length) return '-'
        return (
          <Space wrap size={[4, 4]}>
            {r.hits.slice(0, 5).map((h, idx) => (
              <Tag key={idx} color="blue">
                {riskLabelPath(h) || '-'}
              </Tag>
            ))}
          </Space>
        )
      },
    },
    {
      title: '风险等级',
      key: 'risk_level',
      width: 110,
      render: (_, r) => r.risk_level || '-',
    },
    {
      title: '请求时间',
      key: 'requested_at',
      width: 170,
      render: (_, r) =>
        r.requested_at ? new Date(r.requested_at).toLocaleString('zh-CN') : '-',
    },
    { title: 'IP', key: 'ip', width: 130, render: (_, r) => r.ip || '-' },
    { title: 'AccountId', key: 'account_id', width: 130, render: (_, r) => r.account_id || '-' },
    {
      title: '操作',
      key: 'op',
      width: 200,
      fixed: 'right',
      render: (_, r) => {
        const last = r.last_feedback
        const feedbackItems: MenuProps['items'] = MACHINE_REVIEW_FEEDBACK_OPTIONS.map((o) => ({
          key: o.value,
          label: o.label,
        }))
        const onFeedbackClick: MenuProps['onClick'] = async ({ key }) => {
          if (!r.public_id) {
            message.error('该记录缺少 Request ID，无法反馈')
            return
          }
          const kind = key as MachineReviewFeedbackKind
          try {
            await queryApi.submitFeedback(r.public_id, kind)
            message.success(`已记录：${feedbackLabel(kind)}`)
            fetchResults()
          } catch {
            message.error('反馈提交失败')
          }
        }
        return (
          <Space size={4}>
            <Button type="link" size="small" onClick={() => setDetailRecord(r)}>
              详情
            </Button>
            <span style={{ color: '#CBD5E1' }}>|</span>
            <Dropdown
              menu={{ items: feedbackItems, onClick: onFeedbackClick }}
              trigger={['click']}
              disabled={!r.public_id}
            >
              <Button
                type="link"
                size="small"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
              >
                反馈 <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Dropdown>
            {last && (
              <Tooltip
                title={
                  (last.created_by_name
                    ? `由 ${last.created_by_name} 标记为 ${feedbackLabel(last.kind)}`
                    : `已标记为 ${feedbackLabel(last.kind)}`) +
                  ` · ${new Date(last.created_at).toLocaleString('zh-CN')}`
                }
              >
                <Tag
                  color={FEEDBACK_COLOR[last.kind]}
                  style={{ marginInlineEnd: 0, fontSize: 11 }}
                >
                  {feedbackLabel(last.kind)}
                </Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  const columns = useMemo(
    () =>
      columnsAll.filter(
        (c) => !c.key || c.key === 'op' || visibleSet.has(c.key as QueryColumnKey),
      ),
    [columnsAll, visibleSet],
  )

  const handleAdvancedChange = (patch: {
    channels?: string[]
    ips?: string[]
    account_ids?: string[]
  }) => {
    setFilters((f) => ({ ...f, ...patch }))
    setSubmittedFilters((f) => ({ ...f, ...patch }))
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>数据查询</div>
      </div>

      <Alert
        type="warning"
        showIcon
        message="数据查询仅支持近 90 天，超出范围的结果将被清理，请尽快导出。"
        style={{ marginBottom: 12 }}
      />

      <div style={{ marginBottom: 12 }}>
        <FilterBar
          value={filters}
          onChange={setFilters}
          riskTaxonomy={riskTaxonomy}
          advancedOpen={advancedOpen}
          advancedValues={{
            channels: filters.channels,
            ips: filters.ips,
            account_ids: filters.account_ids,
          }}
          onAdvancedChange={handleAdvancedChange}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
            查询
          </Button>
          <Button onClick={onReset}>重置</Button>
          <Button
            icon={<FilterOutlined />}
            onClick={() => setAdvancedOpen((v) => !v)}
            type={advancedOpen ? 'primary' : 'default'}
            ghost={advancedOpen}
          >
            高级筛选
          </Button>
          <Button
            icon={<CloudDownloadOutlined />}
            href={exportHref}
            target="_blank"
            rel="noreferrer"
            disabled={total === 0}
          >
            导出
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchResults}>
            刷新
          </Button>
          <ColumnSettingsMenu visible={visibleColumns} onChange={setVisibleColumns} />
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p)
            setSize(s)
          },
        }}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
      />

      <RecordDetailDrawer record={detailRecord} onClose={() => setDetailRecord(null)} />
    </div>
  )
}

void DECISION_LABELS
void QUERY_COLUMNS