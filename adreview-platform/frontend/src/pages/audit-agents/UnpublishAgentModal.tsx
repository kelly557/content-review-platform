import { Alert, Button, Modal, Space } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'

export interface UnpublishAgentModalProps {
  open: boolean
  agentName: string
  onCancel: () => void
  onConfirm: () => void
}

export default function UnpublishAgentModal({
  open,
  agentName,
  onCancel,
  onConfirm,
}: UnpublishAgentModalProps) {
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
        message="下线提示"
        description={
          <div style={{ lineHeight: 1.7 }}>
            下线后该智能体将不再提供审核能力，调用方会收到「智能体已下线」错误，通常下线立即生效，请谨慎操作。确认要立即下线{agentName ? `「${agentName}」` : ''}吗?
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