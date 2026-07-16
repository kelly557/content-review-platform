import { Drawer, Empty } from 'antd'
import type { MachineReviewRecord, ReviewRecord } from '@/types/domain'

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
  return (
    <Drawer
      title="预览素材"
      open={!!record}
      onClose={onClose}
      width="clamp(320px, 70vw, 960px)"
      destroyOnClose
    >
      {record ? <FilePreview record={record} /> : null}
    </Drawer>
  )
}