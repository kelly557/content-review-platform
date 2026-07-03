import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import AnnotationCanvas, { type CanvasAnnotation } from '@/components/AnnotationCanvas'
import type { Annotation } from '@/types/domain'

interface Props {
  versionId: number
  downloadUrl: string
  readOnly?: boolean
  /** Called when a new annotation has been persisted. */
  onChanged?: () => void
  /** Forwarded to AnnotationCanvas for annotation list highlight etc. */
  focusAnnotationId?: number | null
}

export default function ImagePreview({ versionId, downloadUrl, readOnly, onChanged }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { annotationsApi } = await import('@/api/reviews')
      const res = await annotationsApi.list(versionId, 1, 100)
      setAnnotations(res.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!versionId) return
    load()
  }, [versionId])

  const onCreate = async (a: CanvasAnnotation) => {
    const { annotationsApi } = await import('@/api/reviews')
    await annotationsApi.create({
      version_id: versionId,
      body: a.body,
      x: a.x,
      y: a.y,
      w: a.w,
      h: a.h,
      quote: a.quote,
    })
    await load()
    onChanged?.()
  }

  return (
    <div style={{ position: 'relative', textAlign: 'center', padding: 16 }}>
      <Spin spinning={loading}>
        <AnnotationCanvas
          src={downloadUrl}
          mime="image/*"
          annotations={annotations.map((a) => ({
            id: a.id,
            x: a.x ?? null,
            y: a.y ?? null,
            w: a.w ?? null,
            h: a.h ?? null,
            body: a.body,
            quote: a.quote ?? null,
          }))}
          onCreate={onCreate}
          readOnly={readOnly}
        />
      </Spin>
    </div>
  )
}