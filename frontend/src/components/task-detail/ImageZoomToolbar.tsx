import { Tooltip, Button, Space } from 'antd'
import {
  AimOutlined,
  ExpandOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'

interface Props {
  zoom: number
  setZoom: (z: number | ((prev: number) => number)) => void
  fitWidth: boolean
  setFitWidth: (v: boolean | ((prev: boolean) => boolean)) => void
  onFullScreen: () => void
  canFullScreen: boolean
}

const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

/**
 * Compact zoom + fit-width toolbar for the image preview. Only rendered when
 * ``materialType === 'image'`` — non-image materials should not show these.
 */
export default function ImageZoomToolbar({
  zoom,
  setZoom,
  fitWidth,
  setFitWidth,
  onFullScreen,
  canFullScreen,
}: Props) {
  return (
    <Space size={2}>
      <Tooltip title="放大">
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
        />
      </Tooltip>
      <Tooltip title="缩小">
        <Button
          size="small"
          icon={<MinusOutlined />}
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
        />
      </Tooltip>
      <Tooltip title="适应宽度">
        <Button
          size="small"
          icon={<AimOutlined />}
          type={fitWidth ? 'primary' : 'default'}
          onClick={() => setFitWidth((v) => !v)}
        />
      </Tooltip>
      <Tooltip title="重置">
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            setZoom(1)
            setFitWidth(true)
          }}
        />
      </Tooltip>
      <Tooltip title="新窗口打开原图">
        <Button
          size="small"
          icon={<ExpandOutlined />}
          disabled={!canFullScreen}
          onClick={onFullScreen}
        />
      </Tooltip>
    </Space>
  )
}
