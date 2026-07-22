import { useState } from 'react'
import { App, Button, Form, Input, Modal, Space } from 'antd'

import { riskCategoriesApi } from '@/api/risk-categories'
import { useRiskCategoryStore } from '@/store/riskCategories'

interface Props {
  open: boolean
  onClose: () => void
  /** 创建成功后回调（拿到新字典项） */
  onCreated?: (item: { code: string; label: string; color: string }) => void
}

export default function CreateRiskCategoryModal({ open, onClose, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ label: string }>()
  const [submitting, setSubmitting] = useState(false)
  const addItem = useRiskCategoryStore((s) => s.add)

  const handleSubmit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSubmitting(true)
    try {
      const item = await riskCategoriesApi.create({ label: v.label.trim() })
      addItem(item)
      message.success(`已新建「${item.label}」`)
      onCreated?.({ code: item.code, label: item.label, color: item.color })
      form.resetFields()
      onClose()
    } catch (e: unknown) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (e as { message?: string })?.message ||
        '新建失败'
      message.error(detail)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onClose()
  }

  return (
    <Modal
      open={open}
      title="添加风险类型"
      onCancel={handleCancel}
      destroyOnClose
      maskClosable={!submitting}
      width={420}
      footer={
        <Space>
          <Button onClick={handleCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            下一步
          </Button>
        </Space>
      }
    >
      <Form<{ label: string }>
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ label: '' }}
      >
        <Form.Item
          label="名称"
          name="label"
          rules={[
            { required: true, message: '请输入风险类型名称' },
            { max: 30, message: '限 30 字符' },
            {
              validator: async (_, value: string) => {
                if (!value || !value.trim()) {
                  throw new Error('名称不能为空')
                }
              },
            },
          ]}
        >
          <Input placeholder="如：XSS 类风险" maxLength={30} allowClear autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  )
}
