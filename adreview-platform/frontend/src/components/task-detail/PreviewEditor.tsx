import { useState } from 'react'
import { Alert, Badge, Button, Drawer, Space, Tooltip, Typography } from 'antd'
import {
  AimOutlined,
  CommentOutlined,
  ExpandOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import ImagePreview from './ImagePreview'
import TextPreview from './TextPreview'
import AnnotationList from './AnnotationList'
import { colors } from '@/styles/theme'
import type { MaterialType, ReviewTask } from '@/types/domain'

const { Text } = Typography

interface Props {
  task: ReviewTask | null
  materialType: MaterialType
  materialTitle: string
  downloadUrl: string | null
  textBody?: string | null
  readOnly?: boolean
  annotationRefreshKey: number
  annotationCount?: number
  onAnnotationChanged?: () => void
}

const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

export default function PreviewEditor({
  task,
  materialType,
  materialTitle,
  downloadUrl,
  textBody,
  readOnly,
  annotationRefreshKey,
  annotationCount,
  onAnnotationChanged,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [annotationOpen, setAnnotationOpen] = useState(false)

  const supportsAnnotation = materialType === 'image' || materialType === 'text'

  const renderPreview = () => {
    if (!downloadUrl && materialType !== 'text') {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: colors.muted }}>
          暂无可预览的素材
        </div>
      )
    }

    if (materialType === 'image' && downloadUrl) {
      return (
        <div
          style={{
            overflow: 'auto',
            maxHeight: '100%',
            padding: 16,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-block',
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
              maxWidth: fitWidth ? '100%' : 'none',
            }}
          >
            <ImagePreview
              versionId={task?.material_version_id ?? 0}
              downloadUrl={downloadUrl}
              readOnly={readOnly}
              onChanged={onAnnotationChanged}
            />
          </div>
        </div>
      )
    }

    if (materialType === 'text') {
      return (
        <TextPreview
          versionId={task?.material_version_id ?? 0}
          textBody={textBody ?? ''}
          readOnly={readOnly}
          onChanged={onAnnotationChanged}
        />
      )
    }

    if (materialType === 'pdf' && downloadUrl) {
      return (
        <div style={{ height: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="PDF 预览"
            description="本版本暂不支持 PDF 批注。可查看原文，标注请通过右侧评论进行。"
            style={{ margin: 16 }}
          />
          <iframe
            src={downloadUrl}
            title={materialTitle}
            style={{ width: '100%', height: 'calc(100% - 90px)', border: 'none', background: colors.surface2 }}
          />
        </div>
      )
    }

    if (materialType === 'video' && downloadUrl) {
      return (
        <div style={{ padding: 16 }}>
          <Alert
            type="info"
            showIcon
            message="视频预览"
            description="本版本暂不支持视频批注。可播放查看，标注请通过右侧评论进行。"
            style={{ marginBottom: 16 }}
          />
          <video
            controls
            src={downloadUrl}
            style={{ width: '100%', maxHeight: '70vh', background: colors.foreground, borderRadius: 6 }}
          />
        </div>
      )
    }

    return null
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Text strong style={{ maxWidth: 360 }} ellipsis={{ tooltip: materialTitle }}>
          {materialTitle}
        </Text>
        <Space size={4} wrap>
          <Tooltip title="批注">
            <Badge count={annotationCount ?? 0} size="small" offset={[-2, 2]}>
              <Button
                size="small"
                icon={<CommentOutlined />}
                onClick={() => setAnnotationOpen(true)}
              >
                批注
              </Button>
            </Badge>
          </Tooltip>
          <Tooltip title="放大">
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={materialType !== 'image' || zoom >= ZOOM_MAX}
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            />
          </Tooltip>
          <Tooltip title="缩小">
            <Button
              size="small"
              icon={<MinusOutlined />}
              disabled={materialType !== 'image' || zoom <= ZOOM_MIN}
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            />
          </Tooltip>
          <Tooltip title="适应宽度">
            <Button
              size="small"
              icon={<AimOutlined />}
              disabled={materialType !== 'image'}
              type={fitWidth ? 'primary' : 'default'}
              onClick={() => setFitWidth((v) => !v)}
            />
          </Tooltip>
          <Tooltip title="重置">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              disabled={materialType !== 'image'}
              onClick={() => {
                setZoom(1)
                setFitWidth(true)
              }}
            />
          </Tooltip>
          <Tooltip title="全屏预览（仅图片）">
            <Button
              size="small"
              icon={<ExpandOutlined />}
              disabled={materialType !== 'image' || !downloadUrl}
              onClick={() => {
                if (downloadUrl) window.open(downloadUrl, '_blank')
              }}
            />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{renderPreview()}</div>

      {!supportsAnnotation && (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: '6px 12px', background: colors.surface2 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前素材类型不支持圈选/选区批注，请使用右侧评论。
          </Text>
        </div>
      )}

      <Drawer
        title="批注列表"
        placement="right"
        width={420}
        open={annotationOpen}
        onClose={() => setAnnotationOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <AnnotationList
          versionId={task?.material_version_id ?? 0}
          refreshKey={annotationRefreshKey}
        />
      </Drawer>
    </div>
  )
}