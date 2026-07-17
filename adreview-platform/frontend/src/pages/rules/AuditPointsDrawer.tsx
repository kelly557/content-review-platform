/**
 * 审核点查看抽屉（点击「N 条」按钮触发）
 *
 * - 右侧 Drawer，宽 80%（≥ 1000px）。
 * - 表格行 1000+ 时使用 antd List + 滚动加载（避免一次性渲染 1000+ 行）。
 * - 支持：关键词搜索、来源文件筛选、导出（JSON + Markdown）。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'

import { auditPointsApi } from '@/api/auditPoints'
import { uploadedDocumentsApi } from '@/api/uploadedDocuments'
import type {
  AuditItem,
  AuditPoint,
  UploadedDocument,
} from '@/types/domain'

const { Text, Title } = Typography

interface Props {
  open: boolean
  item: AuditItem | null
  packageCode: string
  onClose: () => void
}

export default function AuditPointsDrawer({ open, item, packageCode, onClose }: Props) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [keyword, setKeyword] = useState('')
  const [sourceFilter, setSourceFilter] = useState<number | 'all' | 'manual'>('all')
  const [detailPoint, setDetailPoint] = useState<AuditPoint | null>(null)

  const reload = async () => {
    if (!item) return
    setLoading(true)
    try {
      const [list, docResp] = await Promise.all([
        auditPointsApi.list(packageCode, { item_id: item.id }),
        uploadedDocumentsApi.list(packageCode, item.id),
      ])
      setPoints(list)
      setDocuments(docResp.documents)
    } catch {
      // toast handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && item) {
      void reload()
      setKeyword('')
      setSourceFilter('all')
      setDetailPoint(null)
    }
  }, [open, item?.id])

  const docMap = useMemo(() => {
    const m = new Map<number, UploadedDocument>()
    documents.forEach((d) => m.set(d.id, d))
    return m
  }, [documents])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return points.filter((p) => {
      if (sourceFilter === 'all') {
        // pass
      } else if (sourceFilter === 'manual') {
        if (p.source_document_id != null) return false
      } else {
        if (p.source_document_id !== sourceFilter) return false
      }
      if (!kw) return true
      const label = (p.label_cn ?? '').toLowerCase()
      const scope = (p.scope_text ?? '').toLowerCase()
      const quote = (p.source_quote ?? '').toLowerCase()
      return label.includes(kw) || scope.includes(kw) || quote.includes(kw)
    })
  }, [points, keyword, sourceFilter])

  const docOptions = useMemo(
    () => [
      { value: 'all' as const, label: `全部来源 (${points.length})` },
      { value: 'manual' as const, label: `人工新建 (${points.filter((p) => p.source_document_id == null).length})` },
      ...documents
        .filter((d) => d.status === 'parsed')
        .map((d) => ({
          value: d.id,
          label: `${d.original_filename} (${d.parsed_point_count})`,
        })),
    ],
    [documents, points],
  )

  const exportJSON = () => {
    if (filtered.length === 0) {
      message.warning('无可导出的数据')
      return
    }
    const data = filtered.map((p) => ({
      label_cn: p.label_cn,
      scope_text: p.scope_text ?? '',
      source_quote: p.source_quote ?? null,
      source_line_no: p.source_line_no ?? null,
      source_filename: p.source_document_id
        ? docMap.get(p.source_document_id)?.original_filename ?? null
        : null,
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    triggerDownload(blob, `${item?.name_cn ?? 'audit-points'}.json`)
  }

  const exportMarkdown = () => {
    if (filtered.length === 0) {
      message.warning('无可导出的数据')
      return
    }
    const lines: string[] = []
    lines.push(`# ${item?.name_cn ?? '审核点'} — 审核点列表`)
    lines.push('')
    lines.push(`> 共 ${filtered.length} 条`)
    lines.push('')
    filtered.forEach((p, i) => {
      lines.push(`## ${i + 1}. ${p.label_cn}`)
      if (p.scope_text) {
        lines.push('')
        lines.push(p.scope_text)
      }
      if (p.source_document_id) {
        const d = docMap.get(p.source_document_id)
        if (d) {
          lines.push('')
          lines.push(`*来源：${d.original_filename}*`)
        }
      }
      if (p.source_quote) {
        lines.push('')
        lines.push(`> 原文：${p.source_quote}`)
      }
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    })
    triggerDownload(blob, `${item?.name_cn ?? 'audit-points'}.md`)
  }

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const columns: ColumnsType<AuditPoint> = [
    {
      title: '#',
      key: 'index',
      width: 56,
      render: (_, _row, index) => <Text type="secondary">{index + 1}</Text>,
    },
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: 240,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '审核内容',
      dataIndex: 'scope_text',
      ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '来源',
      dataIndex: 'source_document_id',
      width: 180,
      render: (id: number | null) => {
        if (id == null) return <Tag>人工</Tag>
        const d = docMap.get(id)
        if (!d) return <Tag>{id}</Tag>
        return (
          <Tooltip title={d.original_filename}>
            <Tag color="blue">📄 {truncate(d.original_filename, 18)}</Tag>
          </Tooltip>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      width: 90,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '未启用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'op',
      width: 80,
      render: (_, row) => (
        <a onClick={() => setDetailPoint(row)}>详情</a>
      ),
    },
  ]

  const parsedDocs = documents.filter((d) => d.status === 'parsed')

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="80%"
      destroyOnHidden
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            审核点详情 — {item?.name_cn}
          </Title>
          <Tag color="blue">共 {points.length} 条</Tag>
          {parsedDocs.length > 0 && (
            <Tag>{parsedDocs.length} 个源文件</Tag>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索审核点 / 审核内容 / 原文"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 320 }}
          />
          <Select
            value={sourceFilter}
            onChange={setSourceFilter}
            options={docOptions}
            style={{ minWidth: 200 }}
            placeholder="来源筛选"
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportJSON}>
            导出 JSON
          </Button>
          <Button onClick={exportMarkdown}>导出 Markdown</Button>
          <Text type="secondary">
            筛选后 {filtered.length} / {points.length}
          </Text>
        </Space>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin />
          </div>
        ) : filtered.length === 0 ? (
          <Empty description={points.length === 0 ? '暂无审核点' : '无匹配结果'} />
        ) : (
          <Table<AuditPoint>
            rowKey="id"
            dataSource={filtered}
            columns={columns}
            size="small"
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ y: 'calc(100vh - 280px)' }}
          />
        )}
      </Space>

      {detailPoint && (
        <AuditPointDetailModal
          point={detailPoint}
          docName={
            detailPoint.source_document_id
              ? docMap.get(detailPoint.source_document_id)?.original_filename ?? null
              : null
          }
          onClose={() => setDetailPoint(null)}
        />
      )}
    </Drawer>
  )
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

// ─────────────── Detail Modal ───────────────

function AuditPointDetailModal({
  point,
  docName,
  onClose,
}: {
  point: AuditPoint
  docName: string | null
  onClose: () => void
}) {
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title="审核点详情"
      placement="right"
      mask={false}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ display: 'block' }}>审核点</Text>
          <Title level={5} style={{ marginTop: 4 }}>{point.label_cn}</Title>
        </div>
        {point.scope_text && (
          <div>
            <Text type="secondary" style={{ display: 'block' }}>审核内容</Text>
            <div style={{ marginTop: 4 }}>{point.scope_text}</div>
          </div>
        )}
        <div>
          <Text type="secondary" style={{ display: 'block' }}>来源</Text>
          <div style={{ marginTop: 4 }}>
            {docName ? (
              <Space>
                <Tag color="blue">📄 {docName}</Tag>
                {point.source_line_no != null && (
                  <Tag>行 {point.source_line_no}</Tag>
                )}
              </Space>
            ) : (
              <Tag>人工新建</Tag>
            )}
          </div>
        </div>
        {point.source_quote && (
          <div>
            <Text type="secondary" style={{ display: 'block' }}>原文片段</Text>
            <div
              style={{
                marginTop: 4,
                padding: 12,
                background: '#FAFAFA',
                borderRadius: 6,
                border: '1px solid #F0F0F0',
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
              }}
            >
              {point.source_quote}
            </div>
          </div>
        )}
        <div>
          <Text type="secondary" style={{ display: 'block' }}>解析时间</Text>
          <div style={{ marginTop: 4 }}>
            {new Date(point.created_at).toLocaleString()}
          </div>
        </div>
        <div>
          <Text type="secondary" style={{ display: 'block' }}>状态</Text>
          <div style={{ marginTop: 4 }}>
            <Tag color={point.is_enabled ? 'green' : 'default'}>
              {point.is_enabled ? '已启用' : '未启用'}
            </Tag>
            <Tag>{point.code}</Tag>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </Space>
    </Drawer>
  )
}