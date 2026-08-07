import { InputNumber, Space, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import {
  DEFAULT_VIDEO_FRAME_INTERVAL_SEC,
  MAX_VIDEO_FRAME_INTERVAL_SEC,
  MIN_VIDEO_FRAME_INTERVAL_SEC,
} from '@/types/domain'

const { Text } = Typography

interface Props {
  value: number
  onChange: (next: number) => void
}

export default function VideoFrameIntervalInput({ value, onChange }: Props) {
  return (
    <div
      style={{
        padding: '12px 0 8px',
        borderTop: '1px solid #F1F5F9',
      }}
    >
      {/* 主行：标签靠左不换行 + InputNumber + 单位横向 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'nowrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#475569',
            fontSize: 14,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <span>视频抽帧频率：</span>
          <Tooltip title="多少秒抽一帧画面进行审核；缺省使用系统默认。">
            <QuestionCircleOutlined style={{ color: '#94A3B8', cursor: 'help' }} />
          </Tooltip>
        </span>
        <Space size={8} align="center" wrap={false}>
          <InputNumber
            min={MIN_VIDEO_FRAME_INTERVAL_SEC}
            max={MAX_VIDEO_FRAME_INTERVAL_SEC}
            step={1}
            value={value}
            onChange={(v) => {
              const num = typeof v === 'number' ? v : DEFAULT_VIDEO_FRAME_INTERVAL_SEC
              if (num < MIN_VIDEO_FRAME_INTERVAL_SEC || num > MAX_VIDEO_FRAME_INTERVAL_SEC) {
                return
              }
              onChange(Math.floor(num))
            }}
            style={{ width: 120 }}
            aria-label="视频抽帧频率（秒）"
          />
          <Text style={{ whiteSpace: 'nowrap' }}>秒抽一帧</Text>
        </Space>
      </div>

      {/* 提示行：紧跟主行下方，左对齐（与 InputNumber 左边缘齐平），靠灰字 */}
      <div
        style={{
          marginTop: 6,
          marginLeft: 0,
          color: '#94A3B8',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        若您未做任何修改，系统将使用默认阈值和规则（默认 {DEFAULT_VIDEO_FRAME_INTERVAL_SEC} 秒/帧）
      </div>
    </div>
  )
}
