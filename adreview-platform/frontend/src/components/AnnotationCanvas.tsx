import { useRef, useState, type CSSProperties } from 'react'
import { Button, Input, Modal, Space } from 'antd'
import { accentRgba, colors } from '@/styles/theme'

export interface CanvasAnnotation {
  body: string
  x: number
  y: number
  w: number
  h: number
  quote?: string
}

interface Props {
  src: string
  mime: string
  annotations: Array<{ id: number; x?: number | null; y?: number | null; w?: number | null; h?: number | null; body: string; quote?: string | null }>
  onCreate: (a: CanvasAnnotation) => Promise<void> | void
  readOnly?: boolean
}

interface DrawRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

/**
 * Image annotation canvas: drag to create a rectangle, release to add a comment.
 * Coordinates are normalized to [0..1] so they survive image scaling.
 */
export default function AnnotationCanvas({ src, annotations, onCreate, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drawing, setDrawing] = useState<DrawRect | null>(null)
  const [pending, setPending] = useState<{ rect: { x: number; y: number; w: number; h: number }; quote?: string } | null>(null)
  const [comment, setComment] = useState('')

  const toNorm = (clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return
    const { x, y } = toNorm(e.clientX, e.clientY)
    setDrawing({ startX: x, startY: y, endX: x, endY: y })
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const { x, y } = toNorm(e.clientX, e.clientY)
    setDrawing({ ...drawing, endX: x, endY: y })
  }

  const onMouseUp = () => {
    if (!drawing) return
    const x = Math.min(drawing.startX, drawing.endX)
    const y = Math.min(drawing.startY, drawing.endY)
    const w = Math.abs(drawing.endX - drawing.startX)
    const h = Math.abs(drawing.endY - drawing.startY)
    setDrawing(null)
    if (w < 0.01 || h < 0.01) return
    setPending({ rect: { x, y, w, h } })
    setComment('')
  }

  const liveRect: { x: number; y: number; w: number; h: number } | null = drawing
    ? {
        x: Math.min(drawing.startX, drawing.endX),
        y: Math.min(drawing.startY, drawing.endY),
        w: Math.abs(drawing.endX - drawing.startX),
        h: Math.abs(drawing.endY - drawing.startY),
      }
    : null

  const overlayStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    cursor: readOnly ? 'default' : 'crosshair',
    userSelect: 'none',
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}
    >
      <img
        src={src}
        alt="preview"
        draggable={false}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', userSelect: 'none' }}
      />
      <div
        style={overlayStyle}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => drawing && onMouseUp()}
        role="region"
        aria-label="图片批注画布，按住鼠标拖动以圈选区域"
      >
        {annotations.map((a) =>
          a.x != null && a.y != null && a.w != null && a.h != null ? (
            <div
              key={a.id}
              style={{
                position: 'absolute',
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                width: `${a.w * 100}%`,
                height: `${a.h * 100}%`,
                border: `2px solid ${colors.accent}`,
                background: accentRgba(0.12),
                pointerEvents: 'none',
                borderRadius: 2,
              }}
              title={a.body}
            />
          ) : null,
        )}
        {liveRect && (
          <div
            style={{
              position: 'absolute',
              left: `${liveRect.x * 100}%`,
              top: `${liveRect.y * 100}%`,
              width: `${liveRect.w * 100}%`,
              height: `${liveRect.h * 100}%`,
              border: `2px dashed ${colors.accent}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      <Modal
        title="添加批注"
        open={!!pending}
        onCancel={() => setPending(null)}
        onOk={async () => {
          if (!pending || !comment.trim()) return
          await onCreate({ body: comment.trim(), ...pending.rect })
          setPending(null)
          setComment('')
        }}
        okButtonProps={{ disabled: !comment.trim() }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="对圈选区域的反馈..."
            autoFocus
          />
          <div style={{ fontSize: 12, color: colors.muted }}>
            区域: {pending && `${(pending.rect.w * 100).toFixed(1)}% × ${(pending.rect.h * 100).toFixed(1)}%`}
          </div>
        </Space>
      </Modal>

      {!readOnly && annotations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Button size="small" onClick={() => setPending(null)} disabled>
            提示：在图片上按住鼠标拖动以圈选批注区域
          </Button>
        </div>
      )}
    </div>
  )
}
