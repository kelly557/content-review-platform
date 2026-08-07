import { Alert, Button, Modal, Space } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'

interface Sibling {
  id: number
  name: string
  version_label: string | null
}

interface Props {
  open: boolean
  newModelName: string
  siblings: Sibling[]
  modalityLabel?: string
  categoryLabel?: string
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmCascadeActivateModal({
  open,
  newModelName,
  siblings,
  modalityLabel,
  categoryLabel,
  confirming,
  onConfirm,
  onCancel,
}: Props) {
  const combo =
    modalityLabel && categoryLabel ? `${modalityLabel} · ${categoryLabel}` : '该组合'

  return (
    <Modal
      open={open}
      title="启用确认"
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel} disabled={confirming}>
            取消
          </Button>
          <Button type="primary" danger loading={confirming} onClick={onConfirm}>
            确认启用
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="启用提示"
        description={
          <div style={{ lineHeight: 1.7 }}>
            <div style={{ marginBottom: 8 }}>
              {combo}
              当前已启用：
            </div>
            <ul style={{ marginTop: 0, marginBottom: 12, paddingLeft: 20 }}>
              {siblings.map((s) => (
                <li key={s.id}>
                  「{s.name}」
                  {s.version_label ? `（${s.version_label}）` : ''}
                </li>
              ))}
            </ul>
            <div>
              启用「{newModelName}」后，上面的模型将被自动停用。
              配置变更将直接影响线上环境，通常线上生效需要2~5分钟，请谨慎操作。确认要立即启用「
              {newModelName}」吗？
            </div>
          </div>
        }
        style={{
          background: '#FFFBE6',
          border: '1px solid #FFE58F',
        }}
      />
    </Modal>
  )
}