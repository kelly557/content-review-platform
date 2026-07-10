import { App, Card, Radio, Space, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

export interface ComposeSegment {
  /** 段标题，例如 "文本审核"；仅当 segments.length > 1 时渲染 */
  title: string
  /** 当前模式语义值 */
  mode: string
  /** 复用模式的合法语义值（当 mode === reuseLabelValue 时为「复用」状态） */
  reuseValue: string
  /** 复用模式的展示文案，例如 "复用文本审核规则" */
  reuseLabel: string
  /** 「设置独立规则」的语义值 */
  independentValue: string
  /** tooltip 帮助文案 */
  helpText?: string
}

interface Props {
  cardTitle?: string
  segments: ReadonlyArray<ComposeSegment>
  independentLabel?: string
  onSegmentChange: (segmentIndex: number, nextMode: string) => void
  onConfirmSegmentSwitch?: (segmentIndex: number, nextMode: string) => Promise<boolean> | boolean
  extra?: React.ReactNode
}

const DEFAULT_INDEPENDENT_LABEL = '设置独立规则'
const REUSE_HELP_DEFAULT =
  '复用模式时，该段审核的规则完全镜像对应来源的配置；切换为独立规则后将显示独立的规则配置。'

export default function ComposeRuleCard({
  cardTitle,
  segments,
  independentLabel = DEFAULT_INDEPENDENT_LABEL,
  onSegmentChange,
  onConfirmSegmentSwitch,
  extra,
}: Props) {
  const { modal } = App.useApp()

  const handleChange = (segmentIndex: number, nextMode: string) => {
    const seg = segments[segmentIndex]
    if (seg.mode === nextMode) return
    const apply = () => onSegmentChange(segmentIndex, nextMode)
    if (!onConfirmSegmentSwitch) {
      apply()
      return
    }
    const goingIndependent = nextMode === seg.independentValue
    modal.confirm({
      title: goingIndependent
        ? `切换「${seg.title}」为「${independentLabel}」`
        : `切换「${seg.title}」为「${seg.reuseLabel}」`,
      content: goingIndependent
        ? `切换后，${seg.title}将显示独立的${seg.title}规则（默认全部未启用）。当前自定义规则将被清空，是否继续？`
        : `切换后，该段审核将完全复用对应规则。当前自定义规则将被忽略，是否继续？`,
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        const ok = await onConfirmSegmentSwitch(segmentIndex, nextMode)
        if (ok) apply()
        return ok
      },
    })
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: '#0F172A',
  }

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    alignItems: 'center',
    padding: '12px 0',
    borderTop: '1px solid #F1F5F9',
  }

  const labelStyle: React.CSSProperties = {
    color: '#475569',
    fontSize: 14,
  }

  return (
    <Card
      bordered
      size="small"
      style={{ width: '100%' }}
      title={cardTitle ? <span style={sectionTitle}>{cardTitle}</span> : null}
      extra={extra ?? <Text type="secondary" style={{ fontSize: 12 }} />}
      styles={{ body: { padding: '4px 20px 12px' } }}
    >
      {segments.map((seg, idx) => (
        <div key={`${seg.title}-${idx}`}>
          {segments.length > 1 && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#0F172A',
                paddingTop: idx === 0 ? 4 : 16,
                paddingBottom: 0,
              }}
            >
              {seg.title}
            </div>
          )}
          <div style={rowStyle}>
            <span style={labelStyle}>审核规则：</span>
            <Space size={24} align="center">
              <Radio
                checked={seg.mode === seg.reuseValue}
                onChange={() => handleChange(idx, seg.reuseValue)}
              >
                {seg.reuseLabel}
              </Radio>
              <Tooltip title={seg.helpText ?? REUSE_HELP_DEFAULT}>
                <QuestionCircleOutlined style={{ color: '#94A3B8' }} />
              </Tooltip>
              <Radio
                checked={seg.mode === seg.independentValue}
                onChange={() => handleChange(idx, seg.independentValue)}
              >
                {independentLabel}
              </Radio>
            </Space>
          </div>
        </div>
      ))}
    </Card>
  )
}
