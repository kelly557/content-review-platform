import { Form, Input, Select } from 'antd'
import { CHANNEL_OPTIONS, INDUSTRY_OPTIONS, KEYWORD_PLACEHOLDER } from '@/lib/taskOptions'
import type { ReferenceFormValues } from '@/lib/referenceFields'

export type { ReferenceFormValues } from '@/lib/referenceFields'

export interface ReferenceFieldsProps {
  value?: ReferenceFormValues
  onChange?: (v: ReferenceFormValues) => void
}

const FIELD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 16,
} as const

export default function ReferenceFields({ value, onChange }: ReferenceFieldsProps) {
  const [form] = Form.useForm<ReferenceFormValues>()

  const handleChange = (_: Partial<ReferenceFormValues>, all: ReferenceFormValues) => {
    onChange?.(all)
  }

  return (
    <Form form={form} layout="vertical" onValuesChange={handleChange} initialValues={value}>
      <div style={FIELD_GRID}>
        <Form.Item
          label="产品 SKU"
          name="product_sku"
          tooltip="可选；用于关联商品，便于在审核结果中按 SKU 检索"
          style={{ marginBottom: 0 }}
        >
          <Input allowClear placeholder="如 SKU-12345" maxLength={100} />
        </Form.Item>

        <Form.Item
          label="渠道"
          name="channels"
          tooltip="素材投放渠道，可多选"
          style={{ marginBottom: 0 }}
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="未选择"
            options={CHANNEL_OPTIONS as unknown as { value: string; label: string }[]}
          />
        </Form.Item>

        <Form.Item label="行业" name="industry" style={{ marginBottom: 0 }}>
          <Select
            allowClear
            placeholder="未选择"
            options={INDUSTRY_OPTIONS as unknown as { value: string; label: string }[]}
          />
        </Form.Item>

        <Form.Item label="关键词" name="keyword" style={{ marginBottom: 0 }}>
          <Input placeholder={KEYWORD_PLACEHOLDER} allowClear maxLength={200} />
        </Form.Item>
      </div>
    </Form>
  )
}