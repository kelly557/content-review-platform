/**
 * 文档列表单元格 — 显示当前规则已上传的文件。
 *
 * - 紧凑模式：显示前 2 个文件 + 「N 个文件」入口
 * - 点击「N 个文件」展开 Popover 显示完整列表 + 操作
 * - 行内 + 上传按钮：直接为本规则上传文件
 */
import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Popover,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { UploadProps } from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  PlusOutlined,
  RedoOutlined,
  UploadOutlined,
} from '@ant-design/icons'

import { uploadedDocumentsApi } from '@/api/uploadedDocuments'
import type {
  AuditItem,
  UploadedDocKind,
  UploadedDocStatus,
  UploadedDocument,
} from '@/types/domain'

const { Text } = Typography

const ACCEPT_EXT = '.pdf,.doc,.docx,.txt,.md,.xlsx,.xls,.csv'

interface Props {
  item: AuditItem
  packageCode: string
  onPromptEdit: (doc: UploadedDocument) => void
  onReload: () => void
}

const STATUS_COLOR: Record<UploadedDocStatus, string> = {
  pending: 'default',
  parsing: 'processing',
  parsed: 'success',
  failed: 'error',
}

const STATUS_LABEL: Record<UploadedDocStatus, string> = {
  pending: '待解析',
  parsing: '解析中',
  parsed: '已解析',
  failed: '失败',
}

const KIND_LABEL: Record<UploadedDocKind, string> = {
  structured: '结构化',
  llm: 'LLM',
}

function FileIcon({ filename, kind }: { filename: string; kind: UploadedDocKind }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return <FilePdfOutlined style={{ color: '#F40F02' }} />
  if (ext === 'doc' || ext === 'docx') return <FileWordOutlined style={{ color: '#2A5699' }} />
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileExcelOutlined style={{ color: '#1D6F42' }} />
  return <FileTextOutlined style={{ color: kind === 'llm' ? '#722ED1' : '#1D6F42' }} />
}

export default function DocumentsCell({
  item,
  packageCode,
  onPromptEdit,
  onReload,
}: Props) {
  const { message, modal } = App.useApp()
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPopOpen, setUploadPopOpen] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const resp = await uploadedDocumentsApi.list(packageCode, item.id)
      setDocuments(resp.documents)
    } catch {
      // toast handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // 轮询：有 parsing/pending 状态的文档每 3 秒刷新一次
    const hasInflight = documents.some(
      (d) => d.status === 'parsing' || d.status === 'pending',
    )
    if (!hasInflight) return
    const t = setInterval(() => void reload(), 3000)
    return () => clearInterval(t)
  }, [item.id, documents.some((d) => d.status === 'parsing' || d.status === 'pending')])

  const handleDownload = (doc: UploadedDocument) => {
    const url = uploadedDocumentsApi.downloadUrl(packageCode, item.id, doc.id)
    fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('adreview.token') ?? ''}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = doc.original_filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      })
      .catch(() => message.error('下载失败'))
  }

  const handleDelete = (doc: UploadedDocument) => {
    modal.confirm({
      title: `删除文件 ${doc.original_filename} ？`,
      content: '该文件解析出的所有审核点也会被一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await uploadedDocumentsApi.remove(packageCode, item.id, doc.id)
          message.success('已删除')
          await reload()
          onReload()
        } catch {
          // toast handled
        }
      },
    })
  }

  const handleReparse = async (doc: UploadedDocument) => {
    try {
      await uploadedDocumentsApi.reparse(packageCode, item.id, doc.id)
      message.success('已触发重新解析')
      await reload()
    } catch {
      // toast handled
    }
  }

  const handleRowUpload = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      const docs = await uploadedDocumentsApi.upload(packageCode, item.id, files)
      message.success(`已上传 ${docs.length} 个文件，已加入解析队列`)
      setUploadPopOpen(false)
      await reload()
      onReload()
    } catch {
      // toast handled
    } finally {
      setUploading(false)
    }
  }

  const rowUploadProps: UploadProps = {
    multiple: true,
    accept: ACCEPT_EXT,
    showUploadList: false,
    beforeUpload: (file) => {
      void handleRowUpload([file as File])
      return false
    },
  }

  if (loading && documents.length === 0) {
    return <Spin size="small" />
  }

  const head = documents.slice(0, 2)
  const rest = documents.slice(2)
  const inflight = documents.filter(
    (d) => d.status === 'parsing' || d.status === 'pending',
  ).length

  const compactRender = (docs: UploadedDocument[]) => (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {docs.map((d) => (
        <Space key={d.id} size={6}>
          <FileIcon filename={d.original_filename} kind={d.kind} />
          <Tooltip title={d.original_filename}>
            <Text style={{ maxWidth: 140 }} ellipsis>
              {d.original_filename}
            </Text>
          </Tooltip>
          <Tag color={STATUS_COLOR[d.status]} style={{ marginInline: 0 }}>
            {d.status === 'parsing' ? <Spin size="small" /> : null}{' '}
            {STATUS_LABEL[d.status]}
          </Tag>
          {d.kind === 'llm' && (
            <Tag color="purple" style={{ marginInline: 0 }}>
              {KIND_LABEL[d.kind]}
            </Tag>
          )}
        </Space>
      ))}
    </Space>
  )

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {documents.length === 0 ? (
        <Upload {...rowUploadProps} disabled={uploading}>
          <Button
            size="small"
            type="dashed"
            icon={<UploadOutlined />}
            loading={uploading}
          >
            上传文件
          </Button>
        </Upload>
      ) : (
        <>
          {compactRender(head)}
          {rest.length > 0 && (
            <Popover
              trigger="click"
              placement="left"
              content={
                <div style={{ width: 460, maxHeight: 400, overflowY: 'auto' }}>
                  {compactRender(rest)}
                </div>
              }
              title={`其余 ${rest.length} 个文件`}
            >
              <a style={{ fontSize: 12 }}>还有 {rest.length} 个文件…</a>
            </Popover>
          )}
          {inflight > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ⏳ 解析中 ({inflight})
            </Text>
          )}
          <Space size={8}>
            <Popover
              trigger="click"
              placement="left"
              open={uploadPopOpen}
              onOpenChange={setUploadPopOpen}
              content={
                <div style={{ width: 320 }}>
                  <Upload.Dragger
                    {...rowUploadProps}
                    disabled={uploading}
                    style={{ padding: '8px 0' }}
                  >
                    <p style={{ margin: 0 }}>
                      <UploadOutlined />
                    </p>
                    <p style={{ margin: 0, fontSize: 13 }}>
                      {uploading ? '上传中…' : '点击或拖拽文件到此处'}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: '#999',
                      }}
                    >
                      支持 .pdf/.docx/.txt/.md/.xlsx/.csv
                    </p>
                  </Upload.Dragger>
                </div>
              }
              title={`上传到「${item.name_cn}」`}
            >
              <a style={{ fontSize: 12 }}>
                <PlusOutlined /> 上传文件
              </a>
            </Popover>
            <Popover
              trigger="click"
              placement="left"
              content={
                <div style={{ width: 560, maxHeight: 480, overflowY: 'auto' }}>
                  <DocumentActionList
                    docs={documents}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onReparse={handleReparse}
                    onPromptEdit={onPromptEdit}
                  />
                </div>
              }
              title="文档管理"
            >
              <a style={{ fontSize: 12 }}>管理 ({documents.length})</a>
            </Popover>
          </Space>
        </>
      )}
    </Space>
  )
}

function DocumentActionList({
  docs,
  onDownload,
  onDelete,
  onReparse,
  onPromptEdit,
}: {
  docs: UploadedDocument[]
  onDownload: (d: UploadedDocument) => void
  onDelete: (d: UploadedDocument) => void
  onReparse: (d: UploadedDocument) => void
  onPromptEdit: (d: UploadedDocument) => void
}) {
  if (docs.length === 0) {
    return <Empty description="无文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {docs.map((d) => (
        <div
          key={d.id}
          style={{
            padding: 8,
            border: '1px solid #F0F0F0',
            borderRadius: 6,
          }}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space size={6}>
              <FileIcon filename={d.original_filename} kind={d.kind} />
              <Text strong>{d.original_filename}</Text>
              <Tag color={STATUS_COLOR[d.status]} style={{ marginInline: 0 }}>
                {d.status === 'parsing' ? <Spin size="small" /> : null}{' '}
                {STATUS_LABEL[d.status]}
              </Tag>
              <Tag color={d.kind === 'llm' ? 'purple' : 'green'} style={{ marginInline: 0 }}>
                {KIND_LABEL[d.kind]}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {(d.size_bytes / 1024).toFixed(1)} KB
              </Text>
              {d.parsed_point_count > 0 && (
                <Tag color="blue" style={{ marginInline: 0 }}>
                  {d.parsed_point_count} 条
                </Tag>
              )}
            </Space>
          </Space>
          {d.error_message && (
            <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {d.error_message.length > 200 ? d.error_message.slice(0, 200) + '…' : d.error_message}
            </Text>
          )}
          <Space size={6} style={{ marginTop: 6 }}>
            <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => onDownload(d)}>
              下载
            </Button>
            {d.kind === 'llm' && (
              <Button size="small" icon={<EditOutlined />} onClick={() => onPromptEdit(d)}>
                Prompt
              </Button>
            )}
            <Button size="small" icon={<RedoOutlined />} onClick={() => onReparse(d)}>
              重新解析
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(d)}
            >
              删除
            </Button>
          </Space>
        </div>
      ))}
    </Space>
  )
}