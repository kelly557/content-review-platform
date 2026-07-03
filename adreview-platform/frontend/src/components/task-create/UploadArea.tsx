import { useCallback } from 'react'
import { Button, Input } from 'antd'
import { DeleteOutlined, InboxOutlined, FileTextOutlined } from '@ant-design/icons'
import { TYPE_LABELS, type MaterialType } from '@/types/domain'
import { palette, font } from '@/lib/theme'

const { TextArea } = Input

const ACCEPT_MAP: Record<MaterialType, string | undefined> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/quicktime',
  pdf: 'application/pdf',
  text: undefined,
}

const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/wav,audio/x-wav'

export interface UploadItem {
  key: string
  file: File | null
  /** 用于 voice/audio：上传到后端时改写 mime/后缀，伪装成 mp4 */
  rewriteAsVideo?: boolean
  textBody: string
}

export interface UploadAreaProps {
  /** 后端类型：text/image/video/pdf。语音 Tab 传 'video' 但 allowAudio=true */
  type: MaterialType
  allowAudio?: boolean
  multiple?: boolean
  value: UploadItem[]
  onChange: (items: UploadItem[]) => void
  maxCount?: number
}

function buildItem(f: File, allowAudio: boolean): UploadItem {
  const isAudio = allowAudio && (f.type.startsWith('audio/') || /\.(mp3|wav|m4a)$/i.test(f.name))
  if (isAudio) {
    const renamed = new File([f], `${f.name.replace(/\.[^.]+$/, '')}.mp4`, { type: 'video/mp4' })
    return {
      key: `audio-${renamed.name}-${renamed.size}-${renamed.lastModified}`,
      file: renamed,
      rewriteAsVideo: true,
      textBody: '',
    }
  }
  return { key: `${f.name}-${f.size}-${f.lastModified}`, file: f, textBody: '' }
}

export default function UploadArea({
  type,
  allowAudio = false,
  multiple = false,
  value,
  onChange,
  maxCount = 50,
}: UploadAreaProps) {
  const accept = allowAudio ? AUDIO_ACCEPT : ACCEPT_MAP[type]

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const newItems = files.map((f) => buildItem(f, allowAudio))
      if (multiple) {
        onChange([...value, ...newItems].slice(0, maxCount))
      } else {
        onChange(newItems.slice(0, 1))
      }
    },
    [allowAudio, multiple, value, onChange, maxCount],
  )

  const updateText = (key: string, text: string) => {
    onChange(value.map((v) => (v.key === key ? { ...v, textBody: text } : v)))
  }

  const removeItem = (key: string) => {
    onChange(value.filter((v) => v.key !== key))
  }

    if (type === 'text') {
      return (
        <div>
          {value.length === 0 ? (
            <div
              style={{
                border: `1px dashed ${palette.borderStrong}`,
                borderRadius: 10,
                padding: '48px 20px',
                textAlign: 'center',
                background: palette.surfaceAlt,
                color: palette.inkMuted,
              }}
            >
              <FileTextOutlined style={{ fontSize: 32, marginBottom: 8, color: palette.inkMuted }} />
              <div
                style={{
                  fontWeight: 500,
                  color: palette.ink,
                  fontFamily: font.serif,
                  fontSize: 15,
                }}
              >
                暂无文案
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: palette.inkSubtle }}>
                在下方输入或粘贴文案正文
              </div>
            </div>
          ) : (
            value.map((item) => (
              <div key={item.key} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: palette.inkMuted }}>
                    {item.file ? `文件：${item.file.name}` : '纯文本输入'}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeItem(item.key)}
                  >
                    移除
                  </Button>
                </div>
                <TextArea
                  rows={6}
                  value={item.textBody}
                  onChange={(e) => updateText(item.key, e.target.value)}
                  placeholder="文案正文"
                />
              </div>
            ))
          )}
          <Button
            type="dashed"
            block
            style={{ marginTop: value.length === 0 ? 0 : 12 }}
            onClick={() =>
              onChange([...value, { key: `text-${Date.now()}`, file: null, textBody: '' }])
            }
          >
            {value.length === 0 ? '新建文案' : '追加文案'}
          </Button>
        </div>
      )
    }

    if (value.length === 0) {
      return (
        <div
          style={{
            border: `1px dashed ${palette.borderStrong}`,
            borderRadius: 10,
            padding: '40px 20px',
            textAlign: 'center',
            background: palette.surfaceAlt,
          }}
        >
          <input
            type="file"
            multiple={multiple}
            accept={accept}
            onChange={(e) => {
              const files = e.target.files
              if (!files || files.length === 0) return
              handleFiles(Array.from(files))
              e.target.value = ''
            }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
            }}
          />
          <InboxOutlined style={{ fontSize: 40, color: palette.inkMuted, marginBottom: 12 }} />
          <div
            style={{
              fontFamily: font.serif,
              fontSize: 16,
              color: palette.ink,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            点击或拖拽{TYPE_LABELS[type]}到此处
          </div>
          <div style={{ fontSize: 12, color: palette.inkMuted }}>
            支持 {ACCEPT_MAP[type]?.split(',').join(' / ')}，单次最多 {maxCount} 个
          </div>
        </div>
      )
    }

    return (
      <div>
        <div
          style={{
            border: `1px dashed ${palette.borderStrong}`,
            borderRadius: 10,
            padding: '16px 20px',
            textAlign: 'center',
            background: palette.surfaceAlt,
            marginBottom: 12,
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <input
            type="file"
            multiple={multiple}
            accept={accept}
            onChange={(e) => {
              const files = e.target.files
              if (!files || files.length === 0) return
              handleFiles(Array.from(files))
              e.target.value = ''
            }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
            }}
          />
          <span style={{ color: palette.inkMuted, fontSize: 13 }}>
            <InboxOutlined /> 继续添加 / 替换文件
          </span>
        </div>
        <div>
          {value.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                border: `1px solid ${palette.border}`,
                borderRadius: 8,
                marginBottom: 6,
                background: palette.surface,
              }}
            >
              <span style={{ color: palette.ink, fontSize: 13 }}>
                {item.file ? item.file.name : '(无文件)'}{' '}
                <span style={{ color: palette.inkSubtle, fontSize: 12, marginLeft: 8 }}>
                  {item.file ? `${(item.file.size / 1024).toFixed(1)} KB` : ''}
                </span>
              </span>
              <Button type="link" size="small" danger onClick={() => removeItem(item.key)}>
                移除
              </Button>
            </div>
          ))}
        </div>
      </div>
    )
}
