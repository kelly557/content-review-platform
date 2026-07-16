import { ZoomInOutlined } from '@ant-design/icons'
import type { MachineReviewRecord } from '@/types/domain'

const TEXT_PREVIEW_LIMIT = 64
const THUMB_SIZE = 56

interface Props {
  record: MachineReviewRecord
  onPreview: (record: MachineReviewRecord) => void
}

function summarizeText(body: string | null | undefined): string {
  const trimmed = (body ?? '').trim()
  if (!trimmed) return ''
  return trimmed.length > TEXT_PREVIEW_LIMIT
    ? `${trimmed.slice(0, TEXT_PREVIEW_LIMIT)}…`
    : trimmed
}

function fileLabelFor(mime: string | null | undefined): string {
  if (!mime) return '素材'
  if (mime.startsWith('image/')) return '图片'
  if (mime.startsWith('audio/')) return '音频'
  if (mime.startsWith('video/')) return '视频'
  if (mime === 'application/pdf') return 'PDF 文件'
  if (mime.startsWith('text/')) return '文本文件'
  return '素材'
}

const wrapperStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #E2E8F0',
  background: '#F8FAFC',
  cursor: 'pointer',
  maxWidth: 320,
  color: '#1E293B',
  fontSize: 13,
  lineHeight: 1.5,
}

const iconStyle: React.CSSProperties = {
  color: '#3B82F6',
  fontSize: 16,
  flexShrink: 0,
}

export default function ContentPreviewCell({ record, onPreview }: Props) {
  const media = record.content_media
  const previewUrl = record.preview_url

  if (!media) {
    return <span style={{ color: '#94A3B8' }}>—</span>
  }

  const handleClick = () => onPreview(record)

  if (media === 'text') {
    const summary = summarizeText(record.text_body)
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label="点击查看完整素材"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        style={wrapperStyle}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 220,
          }}
          title={record.text_body ?? ''}
        >
          {summary || '无文本内容'}
        </span>
        <ZoomInOutlined style={iconStyle} />
      </span>
    )
  }

  if (!previewUrl) {
    return <span style={{ color: '#94A3B8' }}>无预览</span>
  }

  if (media === 'image') {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label="点击查看完整素材"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        style={wrapperStyle}
      >
        <img
          src={previewUrl}
          alt="缩略图"
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            objectFit: 'cover',
            borderRadius: 4,
            flexShrink: 0,
          }}
        />
        <ZoomInOutlined style={iconStyle} />
      </span>
    )
  }

  if (media === 'audio') {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label="点击查看完整素材"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        style={wrapperStyle}
      >
        <span style={{ fontSize: 16 }}>♪</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileLabelFor(record.mime_type)}
        </span>
        <ZoomInOutlined style={iconStyle} />
      </span>
    )
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="点击查看完整素材"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      style={wrapperStyle}
    >
      <span style={{ fontSize: 16 }}>▶</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fileLabelFor(record.mime_type)}
      </span>
      <ZoomInOutlined style={iconStyle} />
    </span>
  )
}