import { useEffect, useState } from 'react'
import { Form, Input, Modal, Radio } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

export type Step1Modality = '文本' | '图文'

export interface CreateAgentStep1Payload {
  modality: Step1Modality
  name: string
}

interface CreateAgentStep1ModalProps {
  open: boolean
  onCancel: () => void
  onSubmit: (payload: CreateAgentStep1Payload) => void
  submitting?: boolean
}

const MODALITY_OPTIONS: { label: string; value: Step1Modality }[] = [
  { label: '文本', value: '文本' },
  { label: '图文', value: '图文' },
]

export default function CreateAgentStep1Modal({
  open,
  onCancel,
  onSubmit,
  submitting,
}: CreateAgentStep1ModalProps) {
  const [form] = Form.useForm<{ modality: Step1Modality; name: string }>()
  const [submittingLocal, setSubmittingLocal] = useState(false)

  useEffect(() => {
    if (!open) {
      form.resetFields()
      setSubmittingLocal(false)
    } else {
      form.setFieldsValue({ modality: '文本', name: '' })
    }
  }, [open, form])

  const handleOk = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSubmittingLocal(true)
    onSubmit({ modality: values.modality, name: values.name.trim() })
  }

  const loading = submitting || submittingLocal

  return (
    <Modal
      open={open}
      onCancel={loading ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
      width={480}
      centered
      destroyOnHidden
      closeIcon={<CloseOutlined aria-label="关闭创建第一步" />}
      title="创建审核智能体"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          name="modality"
          label="模态"
          rules={[{ required: true, message: '请选择模态' }]}
        >
          <Radio.Group>
            {MODALITY_OPTIONS.map((opt) => (
              <Radio key={opt.value} value={opt.value}>
                {opt.label}
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="name"
          label="智能体名称"
          rules={[
            { required: true, message: '请输入智能体名称' },
            { max: 64, message: '名称最多 64 个字符' },
          ]}
        >
          <Input placeholder="金融专项审核" maxLength={64} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}