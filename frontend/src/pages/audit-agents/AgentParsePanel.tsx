import { Popconfirm, Progress, Space, Tag, Tooltip, Typography, Upload, Button } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  InboxOutlined,
  LoadingOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import {
  ACCEPT_MIME,
  formatBytes,
  type AgentParseDocument,
  type AgentParseStatus,
} from '@/api/agentParseDocs'

const { Text } = Typography

const STATUS_META: Record<
  AgentParseStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  pending: { color: 'default', label: '等待上传', icon: null },
  parsing: { color: 'processing', label: '解析中', icon: <LoadingOutlined spin /> },
  success: { color: 'success', label: '成功', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
}

interface AgentParsePanelProps {
  documents: AgentParseDocument[]
  onAdd: (files: File[]) => void
  onRetry: (docId: string) => void
  onRemove: (docId: string) => void
  onDownload: (doc: AgentParseDocument) => void
  onView: (doc: AgentParseDocument) => void
}

export default function AgentParsePanel({
  documents,
  onAdd,
  onRetry,
  onRemove,
  onDownload,
  onView,
}: AgentParsePanelProps) {
  const stats = {
    success: documents.filter((d) => d.status === 'success').length,
    failed: documents.filter((d) => d.status === 'failed').length,
    parsing: documents.filter((d) => d.status === 'parsing' || d.status === 'pending').length,
  }

  return (
    <div>
      <Upload.Dragger
        multiple={false}
        accept={ACCEPT_MIME.join(',')}
        beforeUpload={(file, list) => {
          onAdd(list ?? [file])
          return false
        }}
        showUploadList={false}
        style={{ marginBottom: 8 }}
      >
        <p>
          <InboxOutlined style={{ fontSize: 28, color: '#1677FF' }} />
        </p>
        <p>上传文件</p>
      </Upload.Dragger>

      {documents.length > 0 && (
        <>
          <div style={{ marginTop: 12, marginBottom: 8 }}>
            <Space size={12}>
              <Text type="secondary">
                成功 <Text strong style={{ color: '#52c41a' }}>{stats.success}</Text>
              </Text>
              <Text type="secondary">
                解析中 <Text strong style={{ color: '#1677FF' }}>{stats.parsing}</Text>
              </Text>
              <Text type="secondary">
                失败 <Text strong style={{ color: '#ff4d4f' }}>{stats.failed}</Text>
              </Text>
            </Space>
          </div>

          <div
            style={{
              border: '1px solid #F0F0F0',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {documents.map((doc, idx) => (
              <div
                key={doc.id}
                style={{
                  padding: 12,
                  borderTop: idx === 0 ? 'none' : '1px solid #F0F0F0',
                  background: '#fafafa',
                }}
              >
                <Space
                  align="start"
                  style={{ width: '100%', justifyContent: 'space-between' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={6} wrap>
                      <Text strong ellipsis style={{ maxWidth: 280 }}>
                        {doc.name}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatBytes(doc.size)}
                      </Text>
                    </Space>
                    <div style={{ marginTop: 6 }}>
                      <Tag color={STATUS_META[doc.status].color} icon={STATUS_META[doc.status].icon ?? undefined}>
                        {STATUS_META[doc.status].label}
                      </Tag>
                      {doc.status === 'parsing' && (
                        <div style={{ marginTop: 6 }}>
                          <Progress percent={doc.progress} size="small" showInfo />
                        </div>
                      )}
                      {doc.status === 'success' && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          解析耗时 {(doc.durationMs! / 1000).toFixed(1)}s,提取 {doc.charCount} 字
                        </Text>
                      )}
                      {doc.status === 'failed' && doc.message && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          错误:{doc.message}
                        </Text>
                      )}
                    </div>
                  </div>
                  <Space size={4} wrap>
                    {doc.status === 'success' && (
                      <>
                        <Tooltip title="查看预览">
                          <Button
                            size="small"
                            type="link"
                            icon={<EyeOutlined />}
                            onClick={() => onView(doc)}
                            aria-label={`查看 ${doc.name}`}
                          >
                            查看
                          </Button>
                        </Tooltip>
                        <Tooltip title="下载原文件">
                          <Button
                            size="small"
                            type="link"
                            icon={<DownloadOutlined />}
                            onClick={() => onDownload(doc)}
                            aria-label={`下载 ${doc.name}`}
                          >
                            下载
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    {doc.status === 'failed' && (
                      <Tooltip title="重新解析">
                        <Button
                          size="small"
                          type="link"
                          icon={<RedoOutlined />}
                          onClick={() => onRetry(doc.id)}
                          aria-label={`重试 ${doc.name}`}
                        >
                          重试
                        </Button>
                      </Tooltip>
                    )}
                    {doc.status !== 'pending' && (
                      <Popconfirm
                        title="确认删除该文件?"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => onRemove(doc.id)}
                      >
                        <Button
                          size="small"
                          type="link"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`删除 ${doc.name}`}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                </Space>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}