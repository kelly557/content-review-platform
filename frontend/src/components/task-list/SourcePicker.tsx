import { Card, Radio, Space, Typography } from 'antd'

const { Text } = Typography

export type IngestSource = 'library' | 'api_push' | 'mq'
export type IngestScope = 'full' | 'incremental'

export interface SourcePickerValue {
  source: IngestSource
  scope: IngestScope
}

interface SourcePickerProps {
  value: SourcePickerValue
  onChange: (next: SourcePickerValue) => void
}

const SOURCE_OPTIONS: Array<{ value: IngestSource; label: string; description: string }> = [
  { value: 'library', label: '素材库', description: '扫描 materials 表中状态为待审/驳回的素材' },
  { value: 'api_push', label: 'API 推送', description: '通过 POST /reviews/tasks/auto 实时下发任务' },
  { value: 'mq', label: '消息队列', description: '通过 Redis Streams 异步消费入队' },
]

const SCOPE_OPTIONS: Array<{ value: IngestScope; label: string; description: string }> = [
  { value: 'full', label: '存量', description: '扫描所有符合条件的素材' },
  { value: 'incremental', label: '增量', description: '只扫描自上次运行以来变化过的素材' },
]

export default function SourcePicker({ value, onChange }: SourcePickerProps) {
  const showScope = value.source === 'library'

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 6, fontSize: 13 }}>
            <Text strong>素材来源</Text>
          </div>
          <Radio.Group
            value={value.source}
            onChange={(e) =>
              onChange({
                source: e.target.value as IngestSource,
                scope: e.target.value === 'library' ? value.scope : 'full',
              })
            }
          >
            <Space direction="vertical">
              {SOURCE_OPTIONS.map((opt) => (
                <Radio key={opt.value} value={opt.value}>
                  <Space direction="vertical" size={0}>
                    <Text strong>{opt.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {opt.description}
                    </Text>
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        {showScope && (
          <div>
            <div style={{ marginBottom: 6, fontSize: 13 }}>
              <Text strong>扫描范围</Text>
            </div>
            <Radio.Group
              value={value.scope}
              onChange={(e) => onChange({ source: value.source, scope: e.target.value as IngestScope })}
            >
              <Space direction="vertical">
                {SCOPE_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value}>
                    <Space direction="vertical" size={0}>
                      <Text strong>{opt.label}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {opt.description}
                      </Text>
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </div>
        )}
      </Space>
    </Card>
  )
}