import { Tag, Typography } from 'antd'
import { FileOutlined } from '@ant-design/icons'
import type { MaterialType } from '@/types/domain'
import { STATUS_LABELS, TYPE_LABELS } from '@/types/domain'
import { palette, font } from '@/lib/theme'

const { Text } = Typography

export interface ParsedFileItem {
  key: string
  file: File | null
  textBody: string
  rewriteAsVideo?: boolean
}

export interface ParsedPickedItem {
  id: number
  title: string
  material_type: MaterialType
  status: string
  updated_at: string
}

export interface AnalysisPanelProps {
  mode: 'upload' | 'library'
  uploadItems: ParsedFileItem[]
  pickedItems: ParsedPickedItem[]
  backendType: MaterialType
  selectedMaterialDetail?: { title: string; status: string; mime?: string }
}

const TYPE_LABEL_FALLBACK: Record<string, string> = {
  audio: '语音',
}

function fileTypeLabel(file: File): string {
  if (file.type.startsWith('image/')) return '图片'
  if (file.type.startsWith('video/')) return '视频/语音'
  if (file.type === 'application/pdf') return 'PDF 文档'
  if (file.type.startsWith('audio/')) return '语音'
  if (file.type === 'text/plain' || file.type.startsWith('text/')) return '文本'
  return '文件'
}

function pickLabel(type: MaterialType, isAudioTab: boolean): string {
  if (isAudioTab) return TYPE_LABEL_FALLBACK.audio
  return TYPE_LABELS[type]
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function AnalysisPanel({
  mode,
  uploadItems,
  pickedItems,
  backendType,
  selectedMaterialDetail,
}: AnalysisPanelProps) {
  const isEmpty = mode === 'upload' ? uploadItems.length === 0 : pickedItems.length === 0

  if (isEmpty) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: palette.inkMuted,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 48,
            height: 48,
            margin: '0 auto 12px',
            borderRadius: '50%',
            border: `1px dashed ${palette.borderStrong}`,
          }}
        />
        <Text style={{ color: palette.inkMuted, fontSize: 13, display: 'block' }}>
          {mode === 'upload' ? '上传素材后，结果将出现在此' : '选择素材后，详情将出现在此'}
        </Text>
        <Text style={{ color: palette.inkSubtle, fontSize: 12, display: 'block', marginTop: 4 }}>
          实时本地解析 · 不上传服务器
        </Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {mode === 'upload' ? (
        uploadItems.map((it, idx) => {
          const f = it.file
          const isAudio = it.rewriteAsVideo
          return (
            <article
              key={it.key}
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: 10,
                padding: 16,
                background: palette.surface,
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: font.serif,
                    fontSize: 12,
                    color: palette.inkSubtle,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.05em',
                  }}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <FileOutlined style={{ color: palette.inkMuted }} />
                <Text
                  strong
                  style={{
                    flex: 1,
                    wordBreak: 'break-all',
                    color: palette.ink,
                    fontFamily: font.serif,
                    fontSize: 14,
                  }}
                >
                  {f ? f.name : '（纯文本输入）'}
                </Text>
                {f && (
                  <span
                    style={{
                      fontSize: 11,
                      color: palette.inkMuted,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {fileTypeLabel(f)}
                  </span>
                )}
                {isAudio && (
                  <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                    语音→视频
                  </Tag>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: palette.inkMuted,
                  marginBottom: 10,
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                {f ? (
                  <>
                    <span>大小 · {formatSize(f.size)}</span>
                    <span>MIME · {f.type || '未知'}</span>
                  </>
                ) : (
                  <span>纯文本</span>
                )}
              </div>
              {it.textBody && (
                <blockquote
                  style={{
                    margin: 0,
                    background: palette.surfaceAlt,
                    borderLeft: `2px solid ${palette.accent}`,
                    borderRadius: 4,
                    padding: '10px 12px',
                    maxHeight: 180,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: palette.ink,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: font.serif,
                  }}
                >
                  {it.textBody.length > 200
                    ? it.textBody.slice(0, 200) + '…'
                    : it.textBody}
                </blockquote>
              )}
            </article>
          )
        })
      ) : (
        pickedItems.map((p) => (
          <article
            key={p.id}
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: 10,
              padding: 16,
              background: palette.surface,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  fontFamily: font.serif,
                  fontSize: 12,
                  color: palette.inkSubtle,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.05em',
                }}
              >
                #{String(p.id).padStart(3, '0')}
              </span>
              <Text
                strong
                style={{
                  flex: 1,
                  wordBreak: 'break-all',
                  color: palette.ink,
                  fontFamily: font.serif,
                  fontSize: 14,
                }}
              >
                {p.title}
              </Text>
              <Tag
                color={p.status === 'draft' ? 'default' : 'error'}
                style={{ marginInlineEnd: 0 }}
              >
                {STATUS_LABELS[p.status as keyof typeof STATUS_LABELS] || p.status}
              </Tag>
            </div>
            <div
              style={{
                fontSize: 12,
                color: palette.inkMuted,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                类型 ·{' '}
                {pickLabel(
                  p.material_type,
                  !!(
                    backendType === 'video' &&
                    p.id === pickedItems[0]?.id &&
                    selectedMaterialDetail?.mime?.startsWith('audio/')
                  ),
                )}
              </span>
              <span>更新 · {new Date(p.updated_at).toLocaleString('zh-CN')}</span>
            </div>
          </article>
        ))
      )}
    </div>
  )
}
