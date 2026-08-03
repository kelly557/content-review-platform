import { Button, Radio, Switch, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { type Intensity } from '@/lib/threshold'

const { Text } = Typography

interface Props {
  /** 检测强度开关状态 */
  enabled: boolean
  /** 开关切换回调 */
  onToggleEnabled: (v: boolean) => void
  /** 当前强度档，受控 */
  value: Intensity
  /** 切换强度档时回调 */
  onChange: (v: Intensity) => void
  /** 点击「恢复默认」按钮：回退到页面加载快照 */
  onRestoreDefault: () => void
  /** 当前阈值是否有改动（控制恢复默认 disabled） */
  dirty: boolean
}

const HELP_TITLE = '检测强度说明'

const HELP_ITEMS: ReactNode[] = [
  <li key="low" style={{ color: '#fff' }}>
    <span style={{ color: '#fff', fontWeight: 600 }}>低等级：</span>
    采用高召回率策略，优先扩大风险覆盖范围，可检测更多潜在风险样本，但可能伴随较高误报率，适用于对漏报容忍度低的场景。
  </li>,
  <li key="high" style={{ color: '#fff' }}>
    <span style={{ color: '#fff', fontWeight: 600 }}>高等级：</span>
    采用高精确率策略，仅保留高置信度风险判定结果，显著降低误报率，但可能漏检部分边缘案例，适用于对误报容忍度低的场景。
  </li>,
  <li key="medium" style={{ color: '#fff' }}>
    <span style={{ color: '#fff', fontWeight: 600 }}>中等级：</span>
    在高召回率和高精确率之间取得平衡。
  </li>,
]

const HELP_CONTENT: ReactNode = (
  <div style={{ maxWidth: 340 }}>
    <div style={{ color: '#fff', fontWeight: 600, marginBottom: 6 }}>{HELP_TITLE}</div>
    <ul style={{ paddingLeft: 18, margin: 0 }}>{HELP_ITEMS}</ul>
  </div>
)

export default function IntensityToolbar({
  enabled,
  onToggleEnabled,
  value,
  onChange,
  onRestoreDefault,
  dirty,
}: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: '#F8FAFC',
        borderRadius: 8,
        flexWrap: 'wrap',
      }}
    >
      <Switch
        checked={enabled}
        onChange={onToggleEnabled}
        checkedChildren="开"
        unCheckedChildren="关"
        aria-label="启用检测强度"
      />
      <Text strong style={{ color: '#0F172A' }}>
        检测强度
      </Text>
      {enabled && (
        <>
          <Radio.Group
            value={value}
            onChange={(e) => onChange(e.target.value as Intensity)}
            optionType="button"
            buttonStyle="solid"
            aria-label="检测强度档位"
          >
            <Radio.Button value="low">低</Radio.Button>
            <Radio.Button value="medium">中</Radio.Button>
            <Radio.Button value="high">高</Radio.Button>
          </Radio.Group>
          <Tooltip title={HELP_CONTENT} placement="topLeft" overlayStyle={{ maxWidth: 380 }}>
            <QuestionCircleOutlined style={{ color: '#64748B', cursor: 'help' }} />
          </Tooltip>
        </>
      )}
      <Button onClick={onRestoreDefault} disabled={!dirty}>
        恢复默认
      </Button>
    </div>
  )
}
