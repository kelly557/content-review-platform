import { useCallback } from 'react'
import { Button, Input } from 'antd'
import { DeleteOutlined, InboxOutlined } from '@ant-design/icons'
import { TYPE_LABELS, type MaterialType } from '@/types/domain'
import { colors } from '@/styles/theme'

const { TextArea } = Input

const ACCEPT_MAP: Record<MaterialType, string | undefined> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/quicktime',
  pdf: 'application/pdf',
  text: undefined,
}

const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/wav,audio/x-wav'

type HintKey = Exclude<MaterialType, 'text'> | 'audio'

const HINT_MAP: Record<HintKey, string> = {
  image: '支持PNG、JPG、JPEG，小于10M，最长边不超过6000px的图',
  video: '支持MP4、AVI、FLV、MOV格式，小于30MB、5分钟的视频',
  pdf: '支持.txt，.doc，.docx，.pdf格式、小于5MB的文档',
  audio: '支持MP3、WAV、AAC、AMR、M4A格式，小于10MB、5分钟的音频',
}

const TEXT_HINT_SINGLE =
  '请输入需要审核的文本内容，单条文本，最多可以输入600字'
const TEXT_HINT_BULK =
  '请输入需要审核的文本，多个文本可以以换行分割，每行文本不超过600字，最多可输入100行文本内容。'

function HintText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: colors.muted,
        marginBottom: 12,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

function hintFor(type: MaterialType, allowAudio: boolean, multiple: boolean): string {
  if (type === 'text') return ''
  const base = HINT_MAP[allowAudio ? 'audio' : type]
  if (multiple) return `${base}，单次最多10张/个`
  return base
}

export interface UploadItem {
  key: string
  file: File | null
  rewriteAsVideo?: boolean
  textBody: string
}

export interface UploadAreaProps {
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
        <HintText>{multiple ? TEXT_HINT_BULK : TEXT_HINT_SINGLE}</HintText>
        {value.map((item) => (
          <div key={item.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: colors.secondary }}>
                {item.file ? `文件：${item.file.name}` : '纯文本输入'}
              </span>
              {value.length > 1 && (
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeItem(item.key)}
                >
                  移除
                </Button>
              )}
            </div>
            <TextArea
              rows={6}
              value={item.textBody}
              onChange={(e) => updateText(item.key, e.target.value)}
              placeholder="请输入需要审核的文本内容"
            />
          </div>
        ))}
      </div>
    )
  }

  if (value.length === 0) {
    return (
      <div>
        <HintText>{hintFor(type, allowAudio, multiple)}</HintText>
        <div
          style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: 6,
            padding: '40px 20px',
            textAlign: 'center',
            background: colors.surface,
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
          <InboxOutlined style={{ fontSize: 40, color: colors.secondary, marginBottom: 12 }} />
          <div
            style={{
              fontSize: 16,
              color: colors.foreground,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            点击或拖拽{TYPE_LABELS[type]}到此处
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <HintText>{hintFor(type, allowAudio, multiple)}</HintText>
      <div
        style={{
          border: `1px dashed ${colors.border}`,
          borderRadius: 6,
          padding: '16px 20px',
          textAlign: 'center',
          background: colors.surface,
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
        <span style={{ color: colors.secondary, fontSize: 13 }}>
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
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              marginBottom: 6,
            }}
          >
            <span style={{ color: colors.foreground, fontSize: 13 }}>
              {item.file ? item.file.name : '(无文件)'}{' '}
              <span style={{ color: colors.secondary, fontSize: 12, marginLeft: 8 }}>
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
