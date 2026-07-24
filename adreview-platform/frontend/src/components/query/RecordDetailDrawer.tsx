import { Card, Descriptions, Drawer, Empty, Space, Tag, Typography } from 'antd'
import type { MachineReviewRecord, ReviewRecord } from '@/types/domain'
import { MACHINE_DECISION_OPTIONS } from '@/types/domain'

const { Text } = Typography

type DetailRecord = MachineReviewRecord | ReviewRecord

interface Props {
  record: DetailRecord | null
  onClose: () => void
}

function previewUrlFor(record: DetailRecord): string | null {
  const url = (record as MachineReviewRecord).preview_url
  if (url) return url
  const mid = record.material_id
  const mvid = record.material_version_id
  if (mid && mvid) return `/api/v1/materials/${mid}/versions/${mvid}/download`
  return null
}

function decisionMeta(v?: string | null) {
  return MACHINE_DECISION_OPTIONS.find((m) => m.value === v)
}

function feedbackLabel(v?: string | null): string {
  if (!v) return '-'
  const map: Record<string, string> = {
    pending: '待处理',
    approved: '通过',
    rejected: '驳回',
    returned: '退回',
  }
  return map[v] ?? v
}

function riskMeta(risk?: string | null): { label: string; color: string } | null {
  if (!risk) return null
  if (risk === '高风险') return { label: risk, color: 'red' }
  if (risk === '中风险') return { label: risk, color: 'orange' }
  if (risk === '低风险') return { label: risk, color: 'blue' }
  if (risk === '无风险') return { label: risk, color: 'green' }
  return { label: risk, color: 'default' }
}

function FilePreview({ record }: { record: DetailRecord }) {
  const r = record as MachineReviewRecord
  const media = r.content_media
  const url = previewUrlFor(record)

  if (!media) return <Empty description="无素材信息" />

  if (media === 'text') {
    const body = (r.text_body ?? '').trim()
    if (!body) return <Empty description="无文本内容" />
    return (
      <div
        style={{
          padding: 16,
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '70vh',
          overflowY: 'auto',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        {body}
      </div>
    )
  }

  if (!url) return <Empty description="无可用预览" />

  if (media === 'image') {
    return (
      <div style={{ padding: 8, background: '#0F172A', borderRadius: 6, textAlign: 'center' }}>
        <img
          src={url}
          alt="素材"
          style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 4 }}
        />
      </div>
    )
  }

  if (media === 'audio') {
    return (
      <div style={{ padding: 16, background: '#F8FAFC', borderRadius: 6 }}>
        <audio controls preload="metadata" src={url} style={{ width: '100%' }}>
          <track kind="captions" />
        </audio>
      </div>
    )
  }

  if (media === 'video') {
    return (
      <div style={{ background: '#000', borderRadius: 6, textAlign: 'center' }}>
        <video
          controls
          autoPlay={false}
          preload="metadata"
          src={url}
          style={{ width: '100%', maxHeight: '75vh', display: 'block', borderRadius: 6 }}
        />
      </div>
    )
  }

  return <Empty description="不支持的素材类型" />
}

export default function RecordDetailDrawer({ record, onClose }: Props) {
  const r = record as MachineReviewRecord | null
  const decision = decisionMeta(r?.machine_decision)
  const risk = riskMeta(r?.risk_level ?? null)
  const hits = r?.hits ?? []
  const hasQuoteHit = hits.some((h) => h.quote)
  const lastFb = r?.last_feedback

  return (
    <Drawer
      title="预览素材"
      open={!!record}
      onClose={onClose}
      width="clamp(320px, 70vw, 1080px)"
      destroyOnClose
    >
      {record ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text strong>素材本体</Text>
            <div style={{ marginTop: 8 }}>
              <FilePreview record={record} />
            </div>
          </div>

          {r && (
            <div>
              <Text strong>机审结果</Text>
              <div style={{ marginTop: 8 }}>
                <Descriptions
                  column={1}
                  size="small"
                  bordered
                  items={[
                    {
                      key: 'machine_decision',
                      label: '检测结果',
                      children: decision ? (
                        <Tag color={decision.color}>{decision.label}</Tag>
                      ) : (
                        '-'
                      ),
                    },
                    {
                      key: 'risk_level',
                      label: '风险等级',
                      children: risk ? <Tag color={risk.color}>{risk.label}</Tag> : '-',
                    },
                    {
                      key: 'feedback',
                      label: '反馈结果',
                      children: feedbackLabel(r.final_decision),
                    },
                    {
                      key: 'hits',
                      label: '命中审核点',
                      children:
                        hits.length === 0 ? (
                          '-'
                        ) : (
                          <Space wrap size={[4, 4]}>
                            {hits.map((h, idx) => {
                              const score = h.score != null ? ` ${(h.score * 100).toFixed(0)}%` : ''
                              return (
                                <Tag key={idx} color="blue">
                                  {h.label_cn || h.label || '-'}${score === '' ? '' : score}
                                </Tag>
                              )
                            })}
                          </Space>
                        ),
                    },
                    {
                      key: 'summary',
                      label: '摘要',
                      children: r.summary ? (
                        <span style={{ whiteSpace: 'pre-wrap' }}>{r.summary}</span>
                      ) : (
                        '-'
                      ),
                    },
                    {
                      key: 'last_feedback',
                      label: '最近反馈',
                      children: lastFb ? (
                        <Space size={6}>
                          <Tag
                            color={lastFb.kind === 'false_positive' ? 'orange' : 'purple'}
                          >
                            {lastFb.kind === 'false_positive' ? '未违规误报' : '违规漏过'}
                          </Tag>
                          {lastFb.created_by_name && (
                            <Text type="secondary">由 {lastFb.created_by_name}</Text>
                          )}
                          <Text type="secondary">
                            {new Date(lastFb.created_at).toLocaleString('zh-CN')}
                          </Text>
                        </Space>
                      ) : (
                        '-'
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          )}

          {hasQuoteHit && r && (
            <div>
              <Text strong>命中证据</Text>
              <div style={{ marginTop: 8 }}>
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {hits
                    .filter((h) => h.quote)
                    .map((h, idx) => (
                      <Card
                        key={idx}
                        size="small"
                        style={{ background: '#F8FAFC', borderColor: '#E2E8F0' }}
                      >
                        <Space wrap>
                          <Tag color="blue">{h.label_cn || h.label || '-'}</Tag>
                          {h.score != null && (
                            <Text type="secondary">
                              置信度 {(h.score * 100).toFixed(1)}%
                            </Text>
                          )}
                        </Space>
                        {h.quote && (
                          <div
                            style={{
                              marginTop: 6,
                              color: '#475569',
                              whiteSpace: 'pre-wrap',
                              fontSize: 13,
                            }}
                          >
                            “{h.quote}”
                          </div>
                        )}
                      </Card>
                    ))}
                </Space>
              </div>
            </div>
          )}
        </Space>
      ) : null}
    </Drawer>
  )
}