import { Button, Space } from 'antd'
import {
  CheckSquareOutlined,
  MinusSquareOutlined,
  SwapOutlined,
  SafetyOutlined,
} from '@ant-design/icons'

interface Props {
  total: number
  selected: number
  onSelectAll: () => void
  onSelectNone: () => void
  onInvert: () => void
  onSelectLowRisk: () => void
  disabled?: boolean
}

export default function PointQuickBar({
  total,
  selected,
  onSelectAll,
  onSelectNone,
  onInvert,
  onSelectLowRisk,
  disabled,
}: Props) {
  return (
    <Space wrap size={4} style={{ paddingLeft: 4 }}>
      <Button
        size="small"
        type="link"
        icon={<CheckSquareOutlined />}
        onClick={onSelectAll}
        disabled={disabled}
      >
        全选
      </Button>
      <Button
        size="small"
        type="link"
        icon={<MinusSquareOutlined />}
        onClick={onSelectNone}
        disabled={disabled}
      >
        全不选
      </Button>
      <Button
        size="small"
        type="link"
        icon={<SwapOutlined />}
        onClick={onInvert}
        disabled={disabled}
      >
        反选
      </Button>
      <Button
        size="small"
        type="link"
        icon={<SafetyOutlined />}
        onClick={onSelectLowRisk}
        disabled={disabled}
      >
        仅低风险
      </Button>
      <span style={{ color: '#94A3B8', fontSize: 12, marginLeft: 8 }}>
        已选 {selected} / {total}
      </span>
    </Space>
  )
}
