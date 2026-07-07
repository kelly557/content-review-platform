import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { knowledgeApi } from '@/api/knowledge'
import { tagsApi } from '@/api/tags'
import {
  KNOWLEDGE_STATUS_OPTIONS,
  TAG_DOMAIN_OPTIONS,
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentSummary,
  type KnowledgeDocumentStatus,
  type KnowledgeScope,
  type TagDomain,
  type TagSummary,
} from '@/types/domain'
import DocumentUploadDrawer from './DocumentUploadDrawer'
import ExtractionReviewDrawer from './ExtractionReviewDrawer'

const { Title, Text } = Typography

function statusMeta(s: KnowledgeDocumentStatus): { color: string; label: string } {
  return (
    KNOWLEDGE_STATUS_OPTIONS.find((o) => o.value === s) ?? { value: s, label: s, color: 'default' }
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function KnowledgeBasePage() {
  const { message, modal } = App.useApp()
  const [filters, setFilters] = useState<{ page: number; size: number; domain?: TagDomain; status?: KnowledgeDocumentStatus; q?: string }>(
    { page: 1, size: 20 },
  )
  const [q, setQ] = useState('')
  const [items, setItems] = useState<KnowledgeDocumentSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detail, setDetail] = useState<KnowledgeDocumentDetail | null>(null)
  const [extractionId, setExtractionId] = useState<string | null>(null)
  const [availableTags, setAvailableTags] = useState<TagSummary[]>([])

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await knowledgeApi.list({ ...filters, q: q || undefined })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.page, filters.size, filters.domain, filters.status])

  useEffect(() => {
    tagsApi
      .list({ size: 100 })
      .then((res) => setAvailableTags(res.items))
      .catch(() => setAvailableTags([]))
  }, [])

  const handleSearch = () => {
    setFilters((f) => ({ ...f, page: 1 }))
    fetchList()
  }

  const handleOpenDetail = async (row: KnowledgeDocumentSummary) => {
    try {
      const d = await knowledgeApi.get(row.id)
      setDetail(d)
    } catch {
      // handled
    }
  }

  const handleExtract = async (row: KnowledgeDocumentSummary) => {
    try {
      const ex = await knowledgeApi.extract(row.id, true)
      message.success('抽取完成')
      setExtractionId(ex.id)
      fetchList()
      handleOpenDetail(row)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '抽取失败')
    }
  }

  const handleDelete = async (row: KnowledgeDocumentSummary) => {
    try {
      await knowledgeApi.remove(row.id)
      message.success('已删除')
      if (detail?.id === row.id) setDetail(null)
      fetchList()
    } catch {
      // handled
    }
  }

  const handleConfirmDelete = (row: KnowledgeDocumentSummary) => {
    modal.confirm({
      title: '确认删除？',
      content: '文档及其抽取记录将被永久删除（仅管理员可操作）',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => handleDelete(row),
    })
  }

  const columns: TableColumnsType<KnowledgeDocumentSummary> = [
    {
      title: '标题',
      dataIndex: 'title',
      width: '26%',
      render: (v: string, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.original_filename} · {formatBytes(row.file_size)}
          </Text>
        </Space>
      ),
    },
    {
      title: '领域',
      dataIndex: 'domain',
      width: '10%',
      render: (d: TagDomain) => (
        <Tag color="geekblue">
          {TAG_DOMAIN_OPTIONS.find((o) => o.value === d)?.cn ?? d}
        </Tag>
      ),
    },
    {
      title: '范围',
      dataIndex: 'scope',
      width: '10%',
      render: (s: KnowledgeScope) => <Tag>{s}</Tag>,
    },
    {
      title: '标签',
      dataIndex: 'tag_ids',
      width: '14%',
      render: (ids: string[]) => {
        if (!ids?.length) return <Text type="secondary">—</Text>
        const matched = availableTags.filter((t) => ids.includes(t.id))
        return (
          <Space size={4} wrap>
            {matched.slice(0, 2).map((t) => (
              <Tag key={t.id}>{t.name}</Tag>
            ))}
            {matched.length > 2 && <Tag>+{matched.length - 2}</Tag>}
          </Space>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: '10%',
      render: (s: KnowledgeDocumentStatus) => {
        const m = statusMeta(s)
        return <Tag color={m.color}>{m.label}</Tag>
      },
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      width: '14%',
      render: (v: string) => (
        <Text type="secondary">{dayjs(v).format('YYYY-MM-DD HH:mm')}</Text>
      ),
    },
    {
      title: '操作',
      width: '16%',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleOpenDetail(row)}>
            查看
          </Button>
          {row.status !== 'extracting' && (
            <Tooltip title="调用 MaaS 重新抽取">
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleExtract(row)}
              >
                重新抽取
              </Button>
            </Tooltip>
          )}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleConfirmDelete(row)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const detailExtractions = useMemo(() => detail?.extractions ?? [], [detail])

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          知识库
        </Title>
        <Text type="secondary">
          上传法规 / 法律 / 行业规范文档，自动学习为审核项与审核点
        </Text>
      </div>

      <div
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          placeholder="搜索标题"
          prefix={<SearchOutlined />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 220 }}
          allowClear
        />
        <Select
          placeholder="领域"
          allowClear
          style={{ width: 140 }}
          value={filters.domain}
          onChange={(v) => setFilters({ ...filters, domain: v, page: 1 })}
          options={TAG_DOMAIN_OPTIONS.map((o) => ({ value: o.value, label: o.cn }))}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 130 }}
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v, page: 1 })}
          options={KNOWLEDGE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Button
          onClick={() => {
            setFilters({ page: 1, size: 20 })
            setQ('')
          }}
        >
          清空
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          onClick={() => setUploadOpen(true)}
        >
          上传文档
        </Button>
      </div>

      <div
        style={{
          background: '#fff',
          padding: '8px 16px',
          borderRadius: 8,
          marginBottom: 8,
          display: 'flex',
          gap: 24,
        }}
      >
        <Text type="secondary">合计</Text>
        <Text>
          文档 <Text strong>{total}</Text>
        </Text>
        <Text type="secondary">已导入</Text>
        <Text strong>{items.filter((i) => i.status === 'imported').length}</Text>
        <Text type="secondary">待审</Text>
        <Text strong>{items.filter((i) => i.status === 'review').length}</Text>
      </div>

      <Table<KnowledgeDocumentSummary>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{
          current: filters.page,
          pageSize: filters.size,
          total,
          showSizeChanger: true,
          onChange: (page, size) => setFilters({ ...filters, page, size }),
        }}
        locale={{ emptyText: <Empty description="暂无文档，试试上传第一份" /> }}
        scroll={{ x: 900 }}
      />

      <DocumentUploadDrawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false)
          fetchList()
        }}
      />

      <Drawer
        open={!!detail}
        onClose={() => {
          setDetail(null)
          setExtractionId(null)
        }}
        title={detail?.title ?? '文档详情'}
        width={520}
        destroyOnClose
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Form layout="vertical" colon={false}>
              <Form.Item label="领域">
                <Tag color="geekblue">
                  {TAG_DOMAIN_OPTIONS.find((o) => o.value === detail.domain)?.cn}
                </Tag>
                <Tag>{detail.scope}</Tag>
              </Form.Item>
              <Form.Item label="文件">
                <Text>{detail.original_filename}</Text>
                <Text type="secondary"> · {formatBytes(detail.file_size)}</Text>
              </Form.Item>
              <Form.Item label="归属 Service">
                <Text code>{detail.target_service_code ?? '尚未生成'}</Text>
              </Form.Item>
              {detail.error_message && (
                <Form.Item label="错误">
                  <Text type="danger">{detail.error_message}</Text>
                </Form.Item>
              )}
            </Form>

            <div>
              <Title level={5} style={{ marginTop: 0 }}>抽取记录</Title>
              {detailExtractions.length === 0 && (
                <Empty description="暂无抽取记录" />
              )}
              {detailExtractions.map((e) => (
                <div
                  key={e.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 8,
                    cursor: 'pointer',
                    background: extractionId === e.id ? '#eff6ff' : '#fff',
                  }}
                  onClick={() => setExtractionId(e.id)}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Text strong>第 {e.round_no} 轮</Text>
                    <Tag
                      color={
                        e.status === 'succeeded'
                          ? 'success'
                          : e.status === 'failed'
                          ? 'error'
                          : 'processing'
                      }
                    >
                      {e.status}
                    </Tag>
                  </Space>
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      模型 {e.model ?? '—'} · tokens {e.prompt_tokens}/{e.completion_tokens} ·{' '}
                      {dayjs(e.created_at).format('YYYY-MM-DD HH:mm')}
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          </Space>
        )}
      </Drawer>

      <ExtractionReviewDrawer
        extractionId={extractionId}
        onClose={() => setExtractionId(null)}
        onImported={() => {
          fetchList()
        }}
      />
    </div>
  )
}