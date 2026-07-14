import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  App,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type {
  KnowledgeDocumentCreate,
  KnowledgeDocumentListItem,
  KnowledgeDocumentStatus,
} from '@/types/domain'
import {
  KNOWLEDGE_DOCUMENT_STATUS_OPTIONS,
  KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS,
} from '@/types/domain'
import { useAuthStore } from '@/store'

const { Text } = Typography

type RegistrationMode = 'upload' | 'url' | 'manual'

interface CreateFormValues {
  code?: string
  title: string
  description?: string
  tags?: string[]
  issued_at?: Dayjs
  status?: KnowledgeDocumentStatus
  mode: RegistrationMode
  source_url?: string
  file?: { fileList: { originFileObj?: File }[] }
}

const MAX_FILE_BYTES = 20 * 1024 * 1024

export default function KnowledgeDocumentListPage() {
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin'

  const [q, setQ] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sourceType, setSourceType] = useState<string | null>(null)
  const [status, setStatus] = useState<KnowledgeDocumentStatus | null>(null)

  const [items, setItems] = useState<KnowledgeDocumentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm<CreateFormValues>()

  const fetchList = async () => {
    setLoading(true)
    try {
      const data = await knowledgeDocumentsApi.list({
        q: q || undefined,
        tag: tagFilter ?? undefined,
        source_type: sourceType ?? undefined,
        status: status ?? undefined,
        size: 50,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    if (!canWrite) {
      message.warning('仅管理员可新建知识文档')
      return
    }
    createForm.resetFields()
    createForm.setFieldsValue({
      status: 'draft',
      mode: 'upload',
    })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const v = await createForm.validateFields().catch(() => null)
    if (!v) return
    setCreating(true)
    try {
      const base: Partial<KnowledgeDocumentCreate> = {
        code: v.code,
        title: v.title,
        description: v.description,
        tags: v.tags || [],
        issued_at: v.issued_at ? v.issued_at.toISOString() : null,
        status: v.status,
      }

      if (v.mode === 'upload') {
        const fileObj = v.file?.fileList?.[0]?.originFileObj
        if (!fileObj) {
          message.error('请选择文件')
          setCreating(false)
          return
        }
        if (fileObj.size > MAX_FILE_BYTES) {
          message.error(`单文件不能超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`)
          setCreating(false)
          return
        }
        await knowledgeDocumentsApi.upload(fileObj, base)
      } else if (v.mode === 'url') {
        if (!v.source_url) {
          message.error('请填写原文 URL')
          setCreating(false)
          return
        }
        await knowledgeDocumentsApi.registerUrl({
          ...(base as KnowledgeDocumentCreate),
          source_type: 'url',
          source_url: v.source_url,
        })
      } else {
        await knowledgeDocumentsApi.create({
          ...(base as KnowledgeDocumentCreate),
          source_type: 'manual',
        })
      }
      message.success('创建成功')
      setCreateOpen(false)
      await fetchList()
    } catch {
      // handled
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (row: KnowledgeDocumentListItem) => {
    try {
      await knowledgeDocumentsApi.delete(row.id)
      message.success('已删除')
      await fetchList()
    } catch {
      // handled
    }
  }

  return (
    <div style={{ width: '100%' }}>
      {!canWrite && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="您当前为只读用户。"
        />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="搜索标题 / 编码"
          onSearch={(v) => {
            setQ(v)
            void fetchList()
          }}
          style={{ width: 240 }}
        />
        <Input
          allowClear
          placeholder="标签（精确匹配）"
          value={tagFilter ?? ''}
          onChange={(e) => setTagFilter(e.target.value || null)}
          onPressEnter={(e) => setTagFilter((e.target as HTMLInputElement).value || null)}
          style={{ width: 180 }}
        />
        <Select
          allowClear
          placeholder="来源方式"
          style={{ width: 150 }}
          value={sourceType ?? undefined}
          onChange={(v) => setSourceType(v ?? null)}
          options={Object.entries(KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status ?? undefined}
          onChange={(v) => setStatus(v ?? null)}
          options={KNOWLEDGE_DOCUMENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          disabled={!canWrite}
        >
          新建知识
        </Button>
      </Space>
      <Table<KnowledgeDocumentListItem>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={items}
        pagination={{
          total,
          pageSize: 50,
          showSizeChanger: false,
          onChange: () => {
            /* server paging later */
          },
        }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '标题', dataIndex: 'title', width: '28%' },
          {
            title: '标签',
            dataIndex: 'tags',
            width: '20%',
            render: (v: string[]) => (
              <Space size={4} wrap>
                {v.slice(0, 3).map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
                {v.length > 3 && <Tag color="default">+{v.length - 3}</Tag>}
              </Space>
            ),
          },
          {
            title: '来源',
            dataIndex: 'source_type',
            width: '10%',
            render: (v: string) => KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS[v as keyof typeof KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS] ?? v,
          },
          {
            title: '发布日期',
            dataIndex: 'issued_at',
            width: '12%',
            render: (v: string | null) =>
              v ? <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span> : '-',
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: '10%',
            render: (v: KnowledgeDocumentStatus) => {
              const opt = KNOWLEDGE_DOCUMENT_STATUS_OPTIONS.find((o) => o.value === v)
              return <Tag color={opt?.color}>{opt?.label ?? v}</Tag>
            },
          },
          {
            title: '更新时间',
            dataIndex: 'updated_at',
            width: '12%',
            render: (v: string | null) =>
              v ? (
                <span style={{ color: '#64748B', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</span>
              ) : (
                '-'
              ),
          },
          {
            title: '操作',
            width: '8%',
            render: (_v: unknown, row: KnowledgeDocumentListItem) => (
              <Space size={4}>
                <Link to={`/resources/knowledge/${row.id}`}>
                  <Button type="link" size="small" icon={<EditOutlined />}>
                    详情
                  </Button>
                </Link>
                <Popconfirm
                  title="删除该知识文档？"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDelete(row)}
                >
                  <Tooltip title={canWrite ? '' : '仅管理员可删除'}>
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={!canWrite}
                    >
                      删除
                    </Button>
                  </Tooltip>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        footer={() => (
          <Text type="secondary">共 {total} 条</Text>
        )}
      />

      <Drawer
        title="新建知识"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={560}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" loading={creating} onClick={submitCreate}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<CreateFormValues> form={createForm} layout="vertical">
          <Form.Item label="来源方式" name="mode" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="upload">上传文件</Radio.Button>
              <Radio.Button value="url">外部链接</Radio.Button>
              <Radio.Button value="manual">仅元数据</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="标题"
            name="title"
            rules={[{ required: true, message: '请填写标题' }, { max: 255 }]}
          >
            <Input placeholder="如：广告法实施指南、广宣品审核手册" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="这份文档用在哪些审核场景（可选）" />
          </Form.Item>
          <Form.Item label="标签" name="tags" tooltip="用于分类与检索，例如：广宣品 / 广告法 / 合规">
            <Select mode="tags" placeholder="按 Enter 添加" />
          </Form.Item>
          <Form.Item label="发布日期" name="issued_at">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true }]}>
            <Select options={KNOWLEDGE_DOCUMENT_STATUS_OPTIONS} />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.mode !== curr.mode}
          >
            {({ getFieldValue }) =>
              getFieldValue('mode') === 'upload' ? (
                <Form.Item
                  label="文件"
                  name="file"
                  valuePropName="fileList"
                  getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
                  rules={[
                    {
                      validator: (_, value) =>
                        Array.isArray(value) && value.length > 0
                          ? Promise.resolve()
                          : Promise.reject(new Error('请选择文件')),
                    },
                  ]}
                >
                  <Upload.Dragger beforeUpload={() => false} maxCount={1} accept=".pdf,.txt,.md,.doc,.docx">
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p>点击或拖拽上传（支持 PDF、TXT、MD、DOC、DOCX，单文件 ≤ 20MB）</p>
                  </Upload.Dragger>
                </Form.Item>
              ) : getFieldValue('mode') === 'url' ? (
                <Form.Item
                  label="原文 URL"
                  name="source_url"
                  rules={[{ required: true, type: 'url', message: '请填写有效 URL' }]}
                >
                  <Input placeholder="https://example.gov.cn/policy/xxx.html" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
