import { App, Card, Checkbox, Radio, Space, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import type { AudioFeatures, VoiceRuleMode } from '@/types/domain'

const { Text } = Typography

interface Props {
  voiceRuleMode: VoiceRuleMode
  onVoiceRuleModeChange: (next: VoiceRuleMode) => void
  audioFeatures: AudioFeatures
  onAudioFeaturesChange: (next: AudioFeatures) => void
  /** 当 mode 由独立 → 复用 时，父级会先清空 audio 维度下的 item/point 状态；这里只负责提示用户 */
  onConfirmModeSwitch?: (next: VoiceRuleMode) => Promise<boolean> | boolean
}

export default function AudioRuleCard({
  voiceRuleMode,
  onVoiceRuleModeChange,
  audioFeatures,
  onAudioFeaturesChange,
  onConfirmModeSwitch,
}: Props) {
  const { modal } = App.useApp()

  const handleModeChange = (next: VoiceRuleMode) => {
    if (next === voiceRuleMode) return
    const apply = () => onVoiceRuleModeChange(next)
    if (!onConfirmModeSwitch) {
      apply()
      return
    }
    modal.confirm({
      title:
        next === 'independent'
          ? '切换为「设置独立规则」'
          : '切换为「复用文本审核规则」',
      content:
        next === 'independent'
          ? '切换后，语音标签下将显示独立的语音规则（默认全部未启用）。当前语音规则将被清空，是否继续？'
          : '切换后，语音审核将完全复用「文本审核」标签下的规则。当前语音标签下的自定义规则将被忽略，是否继续？',
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        const ok = await onConfirmModeSwitch(next)
        if (ok) {
          apply()
        }
        return ok
      },
    })
  }

  const setMoaning = (v: boolean) =>
    onAudioFeaturesChange({
      ...audioFeatures,
      voiceprint: { ...audioFeatures.voiceprint, moaning: v },
    })

  const setNoSpeech = (v: boolean) =>
    onAudioFeaturesChange({
      ...audioFeatures,
      quality: { ...audioFeatures.quality, no_speech: v },
    })

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

  const sectionTitle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: '#0F172A',
  }

  return (
    <Card
      bordered
      size="small"
      style={{ width: '100%' }}
      title={<span style={sectionTitle}>音频规则配置</span>}
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          语音专有能力（声纹 / 音频质量），始终生效
        </Text>
      }
      styles={{ body: { padding: '4px 20px 12px' } }}
    >
      <div style={rowStyle}>
        <span style={labelStyle}>声纹检测：</span>
        <Space size={24}>
          <Checkbox
            checked={audioFeatures.voiceprint.moaning}
            onChange={(e) => setMoaning(e.target.checked)}
          >
            娇喘检测
          </Checkbox>
        </Space>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>音频质量：</span>
        <Space size={24}>
          <Checkbox
            checked={audioFeatures.quality.no_speech}
            onChange={(e) => setNoSpeech(e.target.checked)}
          >
            无语音内容
          </Checkbox>
        </Space>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>审核规则：</span>
        <Space size={24} align="center">
          <Radio
            checked={voiceRuleMode === 'reuse_text'}
            onChange={() => handleModeChange('reuse_text')}
          >
            复用文本审核规则
          </Radio>
          <Tooltip title="复用文本审核规则时，语音审核的规则完全镜像「文本审核」标签下的配置；切换为独立规则后将显示独立的语音规则。">
            <QuestionCircleOutlined style={{ color: '#94A3B8' }} />
          </Tooltip>
          <Radio
            checked={voiceRuleMode === 'independent'}
            onChange={() => handleModeChange('independent')}
          >
            设置独立规则
          </Radio>
        </Space>
      </div>
    </Card>
  )
}
