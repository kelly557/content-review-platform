import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Space, Table, Tag, type TableColumnsType } from 'antd'
import {
  CloudDownloadOutlined,
  FilterOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { queryApi } from '@/api/query'
import {
  DECISION_LABELS,
  DEFAULT_VISIBLE_COLUMNS,
  FEEDBACK_OPTIONS,
  MACHINE_DECISION_OPTIONS,
  QUERY_COLUMNS,
  type MachineReviewRecord,
  type QueryColumnKey,
  type QueryFilters,
} from '@/types/domain'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import FilterBar from '@/components/query/FilterBar'
import AdvancedFilters from '@/components/query/AdvancedFilters'
import ColumnSettingsMenu from '@/components/query/ColumnSettingsMenu'
import RecordDetailDrawer from '@/components/query/RecordDetailDrawer'

const decisionMeta = (v?: string | null) => MACHINE_DECISION_OPTIONS.find((m) => m.value === v)
const feedbackMeta = (v?: string | null) =>
  FEEDBACK_OPTIONS.find((f) => f.value === v)?.label

const COL_STORAGE_KEY = 'adreview.query.visibleColumns'

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
  const [labelOptions, setLabelOptions] = useState<string[]>([])
  const [visibleColumns, setVisibleColumns] = useLocalStorageState<QueryColumnKey[]>(
    COL_STORAGE_KEY,
    DEFAULT_VISIBLE_COLUMNS,
  )
  const [detailRecord, setDetailRecord] = useState<MachineReviewRecord | null>(null)

  const fetchLabels = useCallback(async () => {
    try {
      const res = await queryApi.labels()
      setLabelOptions(res.labels)
    } catch {
      setLabelOptions([])
    }
  }, [])

  useEffect(() => {
    fetchLabels()
  }, [fetchLabels])

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
      title: '策略名称',
      key: 'strategy_name',
      width: 180,
      render: (_, r) => r.strategy_name || r.strategy_code || '-',
    },
    {
      title: '检测结果',
      key: 'machine_decision',
      width: 110,
      render: (_, r) => {
        const meta = decisionMeta(r.machine_decision)
        if (!meta) return '-'
        return <Tag color={meta.color}>{meta.label}</Tag>
      },
    },
    {
      title: '反馈结果',
      key: 'feedback',
      width: 110,
      render: (_, r) => feedbackMeta(r.final_decision) || r.final_decision || '-',
    },
    {
      title: 'Request ID',
      key: 'request_id',
      width: 110,
      render: (_, r) => r.id,
    },
    {
      title: 'Task ID',
      key: 'task_id',
      width: 110,
      render: (_, r) => r.material_version_id ?? '-',
    },
    {
      title: '命中标签及置信度',
      key: 'labels',
      render: (_, r) => {
        if (!r.hits?.length) return '-'
        return (
          <Space wrap size={[4, 4]}>
            {r.hits.slice(0, 5).map((h, idx) => (
              <Tag key={idx} color="blue">
                {h.label_cn || h.label || '-'}
                {h.score != null && ` ${(h.score * 100).toFixed(0)}%`}
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
      width: 80,
      fixed: 'right',
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => setDetailRecord(r)}>
          详情
        </Button>
      ),
    },
  ]

  const columns = useMemo(
    () => columnsAll.filter((c) => !c.key || visibleSet.has(c.key as QueryColumnKey)),
    [columnsAll, visibleSet],
  )

  const handleConditionsChange = (next: import('@/types/domain').AdvancedCondition[]) => {
    setFilters((f) => ({ ...f, conditions: next.length ? next : undefined }))
    setSubmittedFilters((f) => ({ ...f, conditions: next.length ? next : undefined }))
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

      <div style={{ marginBottom: 12 }}>
        <FilterBar value={filters} onChange={setFilters} labelOptions={labelOptions} />
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

      {advancedOpen && (
        <div style={{ marginBottom: 12 }}>
          <AdvancedFilters
            value={filters.conditions ?? []}
            onChange={handleConditionsChange}
            labelOptions={labelOptions}
          />
        </div>
      )}

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

// keep QUERY_COLUMNS / DECISION_LABELS imports referenced for tree-shake safety
void QUERY_COLUMNS
void DECISION_LABELS