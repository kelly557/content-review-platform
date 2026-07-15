import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
  App,
} from 'antd'
import {
  ArrowLeftOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  InboxOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type {
  KnowledgeDocument,
  KnowledgeDocumentSourceType,
  KnowledgeDocumentStatus,
  KnowledgeDocumentVersion,
} from '@/types/domain'
import {
  KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS,
  KNOWLEDGE_DOCUMENT_STATUS_OPTIONS,
} from '@/types/domain'
import { useAuthStore } from '@/store'

const { Title } = Typography

export default function KnowledgeDocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const docId = Number(id)
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const canWrite = user?.role === 'admin' || user?.role === 'superadmin'

  const [doc, setDoc] = useState<KnowledgeDocument | null>(null)
  const [versions, setVersions] = useState<KnowledgeDocumentVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [metaForm] = Form.useForm()

  const fetchAll = async () => {
    setLoading(true)
    try {
      const d = await knowledgeDocumentsApi.get(docId)
      setDoc(d)
      metaForm.setFieldsValue({
        title: d.title,
        description: d.description,
        tags: d.tags ?? [],
        issued_at: d.issued_at ? dayjs(d.issued_at) : undefined,
        status: d.status,
        source_url: d.source_url,
      })
      const v = await knowledgeDocumentsApi.listVersions(docId)
      setVersions(v)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (Number.isFinite(docId)) void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const handleSaveMeta = async () => {
    const v = await metaForm.validateFields().catch(() => null)
    if (!v) return
    setSavingMeta(true)
    try {
      await knowledgeDocumentsApi.update(docId, {
        title: v.title,
        description: v.description,
        tags: v.tags,
        issued_at: v.issued_at ? (v.issued_at as Dayjs).toISOString() : null,
        status: v.status as KnowledgeDocumentStatus,
        source_url: v.source_url,
      })
      message.success('已保存')
      await fetchAll()
    } catch {
      // handled
    } finally {
      setSavingMeta(false)
    }
  }

  const handleUploadVersion = async (file: File) => {
    setUploading(true)
    try {
      await knowledgeDocumentsApi.uploadVersion(docId, file)
      message.success('已上传新版本')
      await fetchAll()
    } catch {
      // handled
    } finally {
      setUploading(false)
    }
    return false
  }

  const handleDeleteDoc = async () => {
    try {
      await knowledgeDocumentsApi.delete(docId)
      message.success('已删除')
      window.history.back()
    } catch {
      // handled
    }
  }

  if (loading && !doc) {
    return <Spin style={{ display: 'block', margin: '20vh auto' }} />
  }

  if (!doc) {
    return <Empty description="未找到文档" />
  }

  const statusOption = KNOWLEDGE_DOCUMENT_STATUS_OPTIONS.find((o) => o.value === doc.status)
  const currentVersion = doc.current_version || versions.find((v) => v.id === doc.current_version_id)
  const sourceLabel =
    KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS[doc.source_type as KnowledgeDocumentSourceType] ??
    doc.source_type

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
      <Space style={{ marginBottom: 12 }}>
        <Link to="/resources/knowledge" style={{ color: '#0369A1' }}>
          <Space size={4} align="center">
            <ArrowLeftOutlined />
            知识库
          </Space>
        </Link>
      </Space>
      <Card
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              {doc.title}
            </Title>
            {statusOption && <Tag color={statusOption.color}>{statusOption.label}</Tag>}
            <Tag>{sourceLabel}</Tag>
          </Space>
        }
        extra={
          <Space>
            {currentVersion?.id && (
              <Button
                type="default"
                icon={<CloudDownloadOutlined />}
                onClick={() => window.open(knowledgeDocumentsApi.downloadUrl(docId, currentVersion.id), '_blank')}
              >
                下载当前版本
              </Button>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={savingMeta}
              disabled={!canWrite}
              onClick={handleSaveMeta}
            >
              保存
            </Button>
            <Popconfirm
              title="删除该知识文档（软删除）？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleDeleteDoc}
            >
              <Button danger icon={<DeleteOutlined />} disabled={!canWrite}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Form form={metaForm} layout="vertical" disabled={!canWrite}>
          <Form.Item label="标题" name="title" rules={[{ required: true, max: 255 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="这份文档用在哪些审核场景" />
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
          <Form.Item label="原文 URL" name="source_url">
            <Input placeholder="适用于外部链接来源" />
          </Form.Item>
        </Form>

        <Title level={5} style={{ marginTop: 16 }}>
          上传新版本
        </Title>
        <Upload.Dragger
          beforeUpload={(file) => {
            void handleUploadVersion(file)
            return false
          }}
          maxCount={1}
          accept=".pdf,.txt,.md,.doc,.docx"
          disabled={!canWrite || uploading}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>点击或拖拽上传（支持 PDF、TXT、MD、DOC、DOCX）</p>
        </Upload.Dragger>

        <Title level={5} style={{ marginTop: 24 }}>
          版本历史
        </Title>
        <Table<KnowledgeDocumentVersion>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={versions}
          columns={[
            { title: '版本号', dataIndex: 'version_no', width: 80 },
            { title: '文件名', dataIndex: 'original_filename', render: (v: string | null) => v || '-' },
            {
              title: '来源',
              dataIndex: 'source_url',
              render: (v: string | null) =>
                v ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : '-',
            },
            { title: '大小', dataIndex: 'file_size', width: 110, render: (v: number | null) => (v ? `${(v / 1024).toFixed(1)} KB` : '-') },
            { title: 'SHA256', dataIndex: 'sha256', render: (v: string | null) => (v ? <code style={{ fontSize: 12 }}>{v.slice(0, 16)}…</code> : '-') },
            { title: '上传时间', dataIndex: 'created_at', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
            {
              title: '操作',
              width: 100,
              render: (_v, row) => (
                <Button
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  onClick={() => window.open(knowledgeDocumentsApi.downloadUrl(docId, row.id), '_blank')}
                >
                  下载
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
