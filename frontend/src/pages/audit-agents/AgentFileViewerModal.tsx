import { Button, Modal, Space, Table, Typography } from 'antd'
import { CloseOutlined, DownloadOutlined } from '@ant-design/icons'
import { type AgentParseDocument } from '@/api/agentParseDocs'

const { Text } = Typography

interface AgentFileViewerModalProps {
  open: boolean
  doc: AgentParseDocument | null
  onClose: () => void
  onDownload: (doc: AgentParseDocument) => void
}

export default function AgentFileViewerModal({
  open,
  doc,
  onClose,
  onDownload,
}: AgentFileViewerModalProps) {
  const points = doc?.points ?? []
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={doc ? `文件预览 · ${doc.name}` : '文件预览'}
      width={720}
      destroyOnHidden
      closeIcon={<CloseOutlined aria-label="关闭预览" />}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>关闭</Button>
          {doc && (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => onDownload(doc)}
            >
              下载
            </Button>
          )}
        </Space>
      }
    >
      {doc ? (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            解析耗时 {(doc.durationMs ?? 0) / 1000}s · 提取 {doc.charCount ?? 0} 字
            {points.length > 0 && ` · 识别 ${points.length} 个审核点`}
          </Text>

          {points.length > 0 && (
            <Table
              size="small"
              pagination={false}
              rowKey={(r, i) => `${r.label}-${i}`}
              style={{ marginTop: 12 }}
              dataSource={points}
              columns={[
                { title: '审核标签', dataIndex: 'label', width: '28%' },
                { title: '审核描述', dataIndex: 'desc' },
              ]}
              scroll={{ y: 240 }}
            />
          )}

          <Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginTop: points.length > 0 ? 16 : 12 }}
          >
            原文预览(最多 50 行)
          </Text>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              background: '#fafafa',
              border: '1px solid #F0F0F0',
              borderRadius: 6,
              maxHeight: 300,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {doc.preview || '(空)'}
          </pre>
        </div>
      ) : (
        <Text type="secondary">无文件</Text>
      )}
    </Modal>
  )
}