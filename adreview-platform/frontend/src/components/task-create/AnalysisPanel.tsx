import { Tag, Typography } from 'antd'
import { FileOutlined } from '@ant-design/icons'
import type { MaterialType } from '@/types/domain'
import { STATUS_LABELS, TYPE_LABELS } from '@/types/domain'
import { colors } from '@/styles/theme'

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
          color: colors.secondary,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 48,
            height: 48,
            margin: '0 auto 12px',
            borderRadius: '50%',
            border: `1px dashed ${colors.border}`,
          }}
        />
        <Text style={{ color: colors.secondary, fontSize: 13, display: 'block' }}>
          {mode === 'upload' ? '上传素材后，结果将出现在此' : '选择素材后，详情将出现在此'}
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
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 16,
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
                    fontSize: 12,
                    color: colors.secondary,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <FileOutlined style={{ color: colors.secondary }} />
                <Text
                  strong
                  style={{
                    flex: 1,
                    wordBreak: 'break-all',
                    color: colors.foreground,
                    fontSize: 14,
                  }}
                >
                  {f ? f.name : '（纯文本输入）'}
                </Text>
                {f && (
                  <span
                    style={{
                      fontSize: 11,
                      color: colors.secondary,
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
                  color: colors.secondary,
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
                    background: colors.muted,
                    borderLeft: `2px solid ${colors.accent}`,
                    borderRadius: 4,
                    padding: '10px 12px',
                    maxHeight: 180,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: colors.foreground,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
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
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  color: colors.secondary,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                #{String(p.id).padStart(3, '0')}
              </span>
              <Text
                strong
                style={{
                  flex: 1,
                  wordBreak: 'break-all',
                  color: colors.foreground,
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
                color: colors.secondary,
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
