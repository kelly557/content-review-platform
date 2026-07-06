import { useEffect, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Space, Spin, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { Annotation } from '@/types/domain'
import { colors } from '@/styles/theme'

const { Paragraph, Text } = Typography

interface Props {
  versionId: number
  textBody: string
  readOnly?: boolean
  onChanged?: () => void
}

interface PendingSelection {
  quote: string
}

export default function TextPreview({ versionId, textBody, readOnly, onChanged }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingSelection | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { annotationsApi } = await import('@/api/reviews')
      const res = await annotationsApi.list(versionId, 1, 100)
      // 仅保留 quote/无坐标的批注（文本批注没有 bbox）
      setAnnotations(res.items.filter((a) => !!a.quote || (!a.x && !a.y && !a.w && !a.h)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!versionId) return
    load()
  }, [versionId])

  const onMouseUp = () => {
    if (readOnly) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString().trim()
    if (!text || !containerRef.current) return
    const node = sel.anchorNode
    if (!node || !containerRef.current.contains(node)) return
    setPending({ quote: text })
    setComment('')
  }

  const onConfirm = async () => {
    if (!pending || !comment.trim()) return
    setSaving(true)
    try {
      const { annotationsApi } = await import('@/api/reviews')
      await annotationsApi.create({
        version_id: versionId,
        body: comment.trim(),
        quote: pending.quote,
      })
      setPending(null)
      setComment('')
      window.getSelection()?.removeAllRanges()
      await load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Space style={{ marginBottom: 12 }}>
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            const sel = window.getSelection()
            const text = sel?.toString().trim() ?? ''
            if (!text) {
              Modal.info({ title: '请先在下方文本中选中要批注的片段', icon: null })
              return
            }
            setPending({ quote: text })
            setComment('')
          }}
          disabled={readOnly}
        >
          添加文字批注
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          提示：在下方文本中拖动选中片段，然后点击此按钮。
        </Text>
      </Space>

      <Spin spinning={loading}>
        <div
          ref={containerRef}
          onMouseUp={onMouseUp}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 16,
            lineHeight: 1.8,
            fontSize: 14,
            color: colors.primary,
            whiteSpace: 'pre-wrap',
            userSelect: 'text',
            minHeight: 200,
          }}
        >
          {textBody || <Empty description="无文本内容" />}
        </div>
      </Spin>

      {annotations.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text strong>已添加的文字批注</Text>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {annotations.map((a) => (
                <div
                  key={a.id}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: 12,
                    background: colors.surface2,
                  }}
                >
                  <Paragraph
                    type="secondary"
                    style={{
                      margin: 0,
                      marginBottom: 4,
                      fontSize: 12,
                      borderLeft: `3px solid ${colors.accent}`,
                      paddingLeft: 8,
                      background: colors.accentSoft,
                      padding: '4px 8px',
                    }}
                  >
                  “{a.quote}”
                </Paragraph>
                <div>{a.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        title="添加文字批注"
        open={!!pending}
        onCancel={() => setPending(null)}
        onOk={onConfirm}
        okButtonProps={{ disabled: !comment.trim(), loading: saving }}
        confirmLoading={saving}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {pending && (
            <Paragraph
              type="secondary"
              style={{
                margin: 0,
                borderLeft: `3px solid ${colors.accent}`,
                paddingLeft: 8,
                background: colors.accentSoft,
                padding: '6px 10px',
              }}
            >
              “{pending.quote}”
            </Paragraph>
          )}
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="对所选片段的反馈..."
            autoFocus
          />
        </Space>
      </Modal>
    </div>
  )
}