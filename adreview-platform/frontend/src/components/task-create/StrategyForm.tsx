import { useEffect, useState } from 'react'
import { Form, Input, Select } from 'antd'
import { strategiesApi } from '@/api/strategies'
import { CHANNEL_OPTIONS, INDUSTRY_OPTIONS, KEYWORD_PLACEHOLDER } from '@/lib/taskOptions'
import type { Strategy } from '@/types/domain'

export interface StrategyFormValues {
  strategy_id?: number
  channels?: string[]
  industry?: string
  keyword?: string
}

export interface StrategyFormProps {
  value?: StrategyFormValues
  onChange?: (v: StrategyFormValues) => void
}

export default function StrategyForm({ value, onChange }: StrategyFormProps) {
  const [form] = Form.useForm<StrategyFormValues>()
  const [strategies, setStrategies] = useState<Strategy[]>([])

  useEffect(() => {
    strategiesApi.list({ size: 100 }).then((s) => {
      setStrategies(s.items)
      const defaultStrategyId = s.items[0]?.id
      form.setFieldsValue({
        strategy_id: defaultStrategyId,
        channels: [],
        industry: undefined,
        keyword: undefined,
        ...value,
      })
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleValuesChange = (_: Partial<StrategyFormValues>, all: StrategyFormValues) => {
    onChange?.(all)
  }

  return (
    <Form
      form={form}
      layout="vertical"
      onValuesChange={handleValuesChange}
      initialValues={value}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <Form.Item label="策略" name="strategy_id" tooltip="选择本任务绑定的审核策略" style={{ marginBottom: 0 }}>
          <Select
            allowClear
            placeholder="未选择"
            options={strategies.map((s) => ({
              value: s.id,
              label: `${s.name}${s.is_active ? '' : '（未启用）'}`,
            }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item label="渠道" name="channels" style={{ marginBottom: 0 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="未选择"
            options={CHANNEL_OPTIONS as unknown as { value: string; label: string }[]}
          />
        </Form.Item>

        <Form.Item label="行业" name="industry" style={{ marginBottom: 0 }}>
          <Select allowClear placeholder="未选择" options={INDUSTRY_OPTIONS as unknown as { value: string; label: string }[]} />
        </Form.Item>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          alignItems: 'start',
          marginTop: 16,
        }}
      >
        <Form.Item label="关键词" name="keyword" style={{ marginBottom: 0, gridColumn: 'span 1' }}>
          <Input placeholder={KEYWORD_PLACEHOLDER} allowClear maxLength={200} />
        </Form.Item>
      </div>
    </Form>
  )
}