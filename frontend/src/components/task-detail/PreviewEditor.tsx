import { useState } from 'react'
import { Alert, Badge, Button, Drawer, Space, Tooltip, Typography } from 'antd'
import { CommentOutlined } from '@ant-design/icons'
import ImagePreview from './ImagePreview'
import TextPreview from './TextPreview'
import AnnotationList from './AnnotationList'
import ImageZoomToolbar from './ImageZoomToolbar'
import type { MaterialType, ReviewTask } from '@/types/domain'
import { colors } from '@/styles/theme'

const { Text } = Typography

interface Props {
  task: ReviewTask | null
  materialType: MaterialType
  downloadUrl: string | null
  textBody?: string | null
  readOnly?: boolean
  annotationRefreshKey: number
  annotationCount?: number
  onAnnotationChanged?: () => void
}

export default function PreviewEditor({
  task,
  materialType,
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
  const isImage = materialType === 'image'

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
            description="可查看原文。标注请使用右上角的批注按钮。"
            style={{ margin: 16 }}
          />
          <iframe
            src={downloadUrl}
            title="pdf-preview"
            style={{
              width: '100%',
              height: 'calc(100% - 90px)',
              border: 'none',
              background: colors.surface2,
            }}
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
            description="可播放查看。标注请使用右上角的批注按钮。"
            style={{ marginBottom: 16 }}
          />
          <video
            controls
            src={downloadUrl}
            style={{
              width: '100%',
              maxHeight: '70vh',
              background: colors.foreground,
              borderRadius: 6,
            }}
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
          justifyContent: 'flex-end',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Space size={4}>
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
          {isImage && (
            <ImageZoomToolbar
              zoom={zoom}
              setZoom={setZoom}
              fitWidth={fitWidth}
              setFitWidth={setFitWidth}
              canFullScreen={!!downloadUrl}
              onFullScreen={() => downloadUrl && window.open(downloadUrl, '_blank')}
            />
          )}
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{renderPreview()}</div>

      {!supportsAnnotation && (
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            padding: '6px 12px',
            background: colors.surface2,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前素材类型不支持圈选批注，请通过批注按钮手动添加备注。
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
