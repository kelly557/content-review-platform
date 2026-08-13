import { ZoomInOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
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
  const [imgFailed, setImgFailed] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  // 图片需要 auth header, <img> 标签不带 token → 用 axios 取 blob URL
  useEffect(() => {
    if (media !== 'image' || !previewUrl || imgFailed) {
      setBlobUrl(null)
      return
    }
    let revoke: string | null = null
    // previewUrl 含 /api/v1 前缀, api baseURL 也是 /api/v1 → 去掉前缀避免重复
    const url = previewUrl.replace(/^\/api\/v1/, '')
    api.get(url, { responseType: 'blob' })
      .then((res) => {
        const u = URL.createObjectURL(res.data)
        revoke = u
        setBlobUrl(u)
      })
      .catch(() => setImgFailed(true))
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [media, previewUrl, imgFailed])

  if (!media) {
    return <span style={{ color: '#94A3B8' }}>—</span>
  }

  const handleClick = () => onPreview(record)

  // 文本素材, 或图片素材无预览/图片加载失败时回退到文本展示
  const textSummary = summarizeText(record.text_body)
  if (media === 'text' || (media === 'image' && (!previewUrl || imgFailed || !blobUrl))) {
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
          {textSummary || (media === 'image' ? '图片素材(在线审核)' : '无文本内容')}
        </span>
        <ZoomInOutlined style={iconStyle} />
      </span>
    )
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
          src={blobUrl ?? undefined}
          alt="缩略图"
          onError={() => setImgFailed(true)}
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

  if (!previewUrl) {
    return <span style={{ color: '#94A3B8' }}>{fileLabelFor(record.mime_type)}</span>
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