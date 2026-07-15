import { Tag } from 'antd'
import type { MachineReviewRecord } from '@/types/domain'

const TEXT_PREVIEW_LIMIT = 240
const IMAGE_MAX_WIDTH = 160
const IMAGE_MAX_HEIGHT = 80
const MEDIA_MAX_WIDTH = 220
const MEDIA_MAX_HEIGHT = 90

interface Props {
  record: MachineReviewRecord
}

function previewUrlFor(record: MachineReviewRecord): string | null {
  if (record.preview_url) return record.preview_url
  if (record.material_id && record.material_version_id) {
    return `/api/v1/materials/${record.material_id}/versions/${record.material_version_id}/download`
  }
  return null
}

function downloadLabelFor(mime: string | null | undefined): string {
  if (!mime) return '下载'
  if (mime.startsWith('image/')) return '查看原图'
  if (mime.startsWith('audio/')) return '下载音频'
  if (mime.startsWith('video/')) return '下载视频'
  if (mime.startsWith('text/') || mime === 'application/pdf') return '下载文件'
  return '下载'
}

export default function ContentPreviewCell({ record }: Props) {
  const previewUrl = previewUrlFor(record)
  const media = record.content_media

  if (!media) {
    return <Tag color="default">—</Tag>
  }

  if (media === 'text') {
    const body = (record.text_body ?? '').trim()
    const text = body.length > TEXT_PREVIEW_LIMIT ? `${body.slice(0, TEXT_PREVIEW_LIMIT)}…` : body
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 360 }}>
        {text ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
        ) : (
          <span style={{ color: '#999' }}>无文本内容</span>
        )}
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer">
            {downloadLabelFor(record.mime_type)}
          </a>
        )}
      </div>
    )
  }

  if (!previewUrl) {
    return <Tag color="default">无可用预览</Tag>
  }

  if (media === 'image') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <img
          src={previewUrl}
          alt="preview"
          style={{
            maxWidth: IMAGE_MAX_WIDTH,
            maxHeight: IMAGE_MAX_HEIGHT,
            objectFit: 'cover',
            borderRadius: 4,
            border: '1px solid #f0f0f0',
          }}
        />
        <a href={previewUrl} target="_blank" rel="noreferrer">
          {downloadLabelFor(record.mime_type)}
        </a>
      </div>
    )
  }

  if (media === 'audio') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: MEDIA_MAX_WIDTH }}>
        <audio
          controls
          preload="none"
          src={previewUrl}
          style={{ width: '100%' }}
        >
          <track kind="captions" />
        </audio>
        <a href={previewUrl} target="_blank" rel="noreferrer">
          {downloadLabelFor(record.mime_type)}
        </a>
      </div>
    )
  }

  // video
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <video
        controls
        preload="metadata"
        src={previewUrl}
        style={{
          maxWidth: MEDIA_MAX_WIDTH,
          maxHeight: MEDIA_MAX_HEIGHT,
          borderRadius: 4,
          border: '1px solid #f0f0f0',
        }}
      />
      <a href={previewUrl} target="_blank" rel="noreferrer">
        {downloadLabelFor(record.mime_type)}
      </a>
    </div>
  )
}