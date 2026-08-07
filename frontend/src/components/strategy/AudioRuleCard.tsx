import { Card, Checkbox, Radio, Space, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import type { AudioFeatures, VoiceRuleMode } from '@/types/domain'

const { Text } = Typography

interface Props {
  voiceRuleMode: VoiceRuleMode
  onVoiceRuleModeChange: (next: VoiceRuleMode) => void
  audioFeatures: AudioFeatures
  onAudioFeaturesChange: (next: AudioFeatures) => void
  /** @deprecated 2026-07-30 全部场景去掉弹窗后不再调用,保留接口仅为不破坏外部调用方 */
  onConfirmModeSwitch?: (next: VoiceRuleMode) => Promise<boolean> | boolean
}

export default function AudioRuleCard({
  voiceRuleMode,
  onVoiceRuleModeChange,
  audioFeatures,
  onAudioFeaturesChange,
  onConfirmModeSwitch: _onConfirmModeSwitch,
}: Props) {
  const handleModeChange = (next: VoiceRuleMode) => {
    if (next === voiceRuleMode) return
    onVoiceRuleModeChange(next)
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
