import { Alert, Button, Modal, Space } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'

export interface PublishAgentModalProps {
  open: boolean
  agentName: string
  onCancel: () => void
  onConfirm: () => void
}

export default function PublishAgentModal({
  open,
  agentName,
  onCancel,
  onConfirm,
}: PublishAgentModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={480}
      destroyOnHidden
      maskClosable={false}
    >
      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="发布提示"
        description={
          <div style={{ lineHeight: 1.7 }}>
            配置发布将直接影响线上环境，通常线上生效需要2~5分钟，请谨慎操作。确认要立即发布{agentName ? `「${agentName}」` : ''}吗?
          </div>
        }
        style={{
          background: '#FFFBE6',
          border: '1px solid #FFE58F',
        }}
      />
      <Space style={{ marginTop: 16, width: '100%', justifyContent: 'flex-end' }}>
        <Button type="primary" onClick={onConfirm}>
          确定
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </Space>
    </Modal>
  )
}