import { Button, Drawer, Empty, Space, Tag, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { MachineHit, MachineReviewRecord, ReviewRecord } from '@/types/domain'
import { MACHINE_DECISION_OPTIONS } from '@/types/domain'

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

function riskLabelPath(h: MachineHit): string {
  // label_cn 已含级联分隔符(如"药品广告法智能体/特殊管理药品禁止网售")时直接返回
  const sub = h.label_cn || h.label || ''
  if (sub.includes('/')) return sub
  // 否则用 audit_item/audit_point/label_cn 三段拼级联
  const item = h.audit_item_label || ''
  const point = h.audit_point_label || ''
  return [item, point, sub].filter(Boolean).join(' / ')
}

function formatScore(score?: number | null): string | null {
  if (score == null || !Number.isFinite(score)) return null
  return `${(score * 100).toFixed(1)}%`
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
  const [imgFailed, setImgFailed] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  // 图片需要 auth header, <img> 不带 token → axios 取 blob URL
  useEffect(() => {
    if (media !== 'image' || !url || imgFailed) {
      setBlobUrl(null)
      return
    }
    let revoke: string | null = null
    // url 含 /api/v1 前缀, api baseURL 也是 /api/v1 → 去掉前缀避免重复
    const fetchUrl = url.replace(/^\/api\/v1/, '')
    api.get(fetchUrl, { responseType: 'blob' })
      .then((res) => {
        const u = URL.createObjectURL(res.data)
        revoke = u
        setBlobUrl(u)
      })
      .catch(() => setImgFailed(true))
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [media, url, imgFailed])

  if (!media) return <Empty description="无素材信息" />

  // 图片素材但无有效预览 URL 或加载失败 → 回退到文本展示
  if (media === 'image' && (!url || imgFailed || !blobUrl)) {
    const body = (r.text_body ?? '').trim()
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
        {body || '图片素材（在线审核，无预览）'}
      </div>
    )
  }

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

  if (media === 'image' && blobUrl) {
    return (
      <div style={{ padding: 8, background: '#0F172A', borderRadius: 6, textAlign: 'center' }}>
        <img
          src={blobUrl}
          alt="素材"
          onError={() => setImgFailed(true)}
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
  const strategyLabel = r?.strategy_name
    ? r.strategy_code
      ? `${r.strategy_name} (${r.strategy_code})`
      : r.strategy_name
    : r?.strategy_code ?? '-'
  const requestedAt = r?.requested_at
    ? new Date(r.requested_at).toLocaleString('zh-CN')
    : '-'

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 14,
    lineHeight: 1.7,
  }
  const labelStyle: React.CSSProperties = {
    flex: '0 0 160px',
    color: '#475569',
    textAlign: 'left',
  }
  const valueStyle: React.CSSProperties = { flex: 1, color: '#0F172A' }

  const responseJson = JSON.stringify(r?.machine_result ?? null, null, 2)
  const hasResponseJson = r?.machine_result != null && Object.keys(r.machine_result).length > 0

  return (
    <Drawer
      title="查看详情"
      open={!!record}
      onClose={onClose}
      width="clamp(320px, 70vw, 1080px)"
      destroyOnClose
    >
      {record ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={rowStyle}>
            <div style={labelStyle}>请求时间：</div>
            <div style={valueStyle}>{requestedAt}</div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>request id：</div>
            <div style={valueStyle}>{r?.id ?? '-'}</div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>素材预览：</div>
            <div style={valueStyle}>
              <FilePreview record={record} />
            </div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>审核策略：</div>
            <div style={valueStyle}>{strategyLabel}</div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>审核结果：</div>
            <div style={valueStyle}>
              {decision ? <Tag color={decision.color}>{decision.label}</Tag> : '-'}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>风险等级：</div>
            <div style={valueStyle}>
              {risk ? <Tag color={risk.color}>{risk.label}</Tag> : '-'}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>命中标签：</div>
            <div style={valueStyle}>
              {hits.length === 0 ? (
                '-'
              ) : (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {hits.map((h, idx) => {
                    const path = riskLabelPath(h) || '-'
                    const score = formatScore(h.score)
                    return (
                      <div key={idx}>
                        <span>{path}</span>
                        {score && (
                          <span style={{ marginLeft: 8, color: '#64748B' }}>
                            置信度 {score}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </Space>
              )}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              返回结果：
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                disabled={!hasResponseJson}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(responseJson)
                    message.success('已复制返回结果')
                  } catch {
                    message.error('复制失败')
                  }
                }}
              >
                复制
              </Button>
            </div>
            <div style={valueStyle} />
          </div>

          <div>
            {hasResponseJson ? (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: '#0F172A',
                  color: '#E2E8F0',
                  borderRadius: 6,
                  fontSize: 12,
                  lineHeight: 1.6,
                  maxHeight: 360,
                  overflow: 'auto',
                  whiteSpace: 'pre',
                }}
              >
                {responseJson}
              </pre>
            ) : (
              <span style={{ color: '#64748B' }}>-</span>
            )}
          </div>
        </Space>
      ) : null}
    </Drawer>
  )
}
