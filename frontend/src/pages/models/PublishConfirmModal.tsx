import { Alert, Modal, Space, Typography } from 'antd'
import type { SmallModelModality } from '@/types/domain'

interface Props {
  open: boolean
  loading: boolean
  modality: SmallModelModality
  categoryLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

export default function PublishConfirmModal({
  open,
  loading,
  modality,
  categoryLabel,
  onCancel,
  onConfirm,
}: Props) {
  const combo = `【${modality === 'text' ? '文本' : '图片'} × ${categoryLabel ?? '未选风险类型'}】`

  return (
    <Modal
      title="发布风险提示"
      open={open}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="我已知晓，立即发布"
      cancelText="我再看看"
      okButtonProps={{ danger: true }}
      onOk={onConfirm}
      maskClosable={!loading}
      width={460}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert
          type="warning"
          showIcon
          message={`本操作会立即启用本模型，并影响 ${combo} 组合下的线上审核业务。`}
        />
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          请确认：
        </Typography.Paragraph>
        <ul style={{ marginTop: 0, paddingLeft: 20 }}>
          <li>已通过「测试」按钮验证本模型输出</li>
          <li>了解当前操作影响范围为该组合下的所有线上请求</li>
        </ul>
      </Space>
    </Modal>
  )
}
