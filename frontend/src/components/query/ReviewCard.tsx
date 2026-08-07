import { Card, Tag, Tooltip, Typography } from 'antd'
import {
  MACHINE_DECISION_OPTIONS,
  TYPE_LABELS,
  type ReviewRecord,
} from '@/types/domain'

const { Text } = Typography

const FINAL_COLOR: Record<string, string> = {
  approved: 'green',
  rejected: 'red',
  returned: 'orange',
  pending: 'default',
}

const FINAL_LABEL: Record<string, string> = {
  approved: '高风险',
  rejected: '高风险',
  returned: '高风险',
  pending: '待复审',
}

function decisionMeta(v?: string | null) {
  return MACHINE_DECISION_OPTIONS.find((m) => m.value === v)
}

interface Props {
  record: ReviewRecord
  onOpenDetail: (record: ReviewRecord) => void
}

export default function ReviewCard({ record, onOpenDetail }: Props) {
  const machine = decisionMeta(record.machine_decision)
  const finalKey = record.final_decision || 'pending'
  const finalLabel = FINAL_LABEL[finalKey] || record.final_decision || '-'
  const finalColor = FINAL_COLOR[finalKey] || 'default'

  const firstHit = record.hits?.[0]?.label_cn || record.hits?.[0]?.label

  const preview = record.preview_url
  const mime = record.mime_type || ''

  return (
    <Card
      hoverable
      size="small"
      styles={{ body: { padding: 12 } }}
      style={{ height: '100%' }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#F1F5F9',
          borderRadius: 4,
          marginBottom: 8,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {preview ? (
          mime.startsWith('image/') ? (
            <img
              src={preview}
              alt={record.title || `task-${record.id}`}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : mime.startsWith('video/') ? (
            <video
              src={preview}
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <a href={preview} target="_blank" rel="noreferrer">
              <Text type="secondary">下载预览</Text>
            </a>
          )
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.material_type
              ? TYPE_LABELS[record.material_type as keyof typeof TYPE_LABELS] ||
                record.material_type
              : '无预览'}
          </Text>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary">机审结果</Text>
          {machine ? (
            <Tag color={machine.color} style={{ margin: 0 }}>
              {machine.label}
            </Tag>
          ) : (
            <Tag style={{ margin: 0 }}>{record.risk_level || '-'}</Tag>
          )}
          <a
            onClick={(e) => {
              e.preventDefault()
              onOpenDetail(record)
            }}
            style={{ marginLeft: 'auto', fontSize: 12 }}
          >
            详细结果
          </a>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary">人审结果</Text>
          <Tag color={finalColor} style={{ margin: 0 }}>
            {finalLabel}
          </Tag>
          {firstHit && (
            <Tooltip title={firstHit}>
              <Tag style={{ margin: 0 }}>{firstHit}</Tag>
            </Tooltip>
          )}
        </div>
      </div>
    </Card>
  )
}