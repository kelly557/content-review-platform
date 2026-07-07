import { Form, Select, Space, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { workflowsApi } from '@/api/workflows'
import {
  EMPTY_HUMAN_REVIEW,
  STRATEGY_RISK_LEVEL_OPTIONS,
  type StrategyHumanReview,
  type WorkflowTemplate,
} from '@/types/domain'

const { Text } = Typography

interface HumanReviewSettingsProps {
  value: StrategyHumanReview
  onChange: (next: StrategyHumanReview) => void
}

export function HumanReviewSettings({ value, onChange }: HumanReviewSettingsProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    workflowsApi
      .list({ prefix: 'hr_', include_inactive: true })
      .then((list) => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = (next: Partial<StrategyHumanReview>) => {
    onChange({ ...value, ...next })
  }

  const onToggle = (checked: boolean) => {
    if (!checked) {
      onChange(EMPTY_HUMAN_REVIEW)
      return
    }
    onChange({
      is_enabled: true,
      risk_levels: value.risk_levels.length > 0 ? value.risk_levels : ['高风险'],
      review_rule_id: value.review_rule_id,
    })
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div
        style={{
          padding: '12px 16px',
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
        }}
      >
        <Form.Item
          label="启用人审复审"
          tooltip="关闭后机审将按默认行为升级（高/中风险），不再受本策略配置控制"
          style={{ marginBottom: 0 }}
        >
          <Space>
            <Switch checked={value.is_enabled} onChange={onToggle} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {value.is_enabled
                ? '已开启 — 机审按下方配置升级到人工复审'
                : '已关闭 — 机审按默认行为升级'}
            </Text>
          </Space>
        </Form.Item>
      </div>

      <Form.Item
        label="触发的风险等级"
        required={value.is_enabled}
        tooltip="机审结果出现下列风险等级时升级到人工复审"
        style={{ marginBottom: 0 }}
      >
        <Select
          mode="multiple"
          value={value.risk_levels}
          onChange={(levels) => patch({ risk_levels: levels })}
          options={[...STRATEGY_RISK_LEVEL_OPTIONS]}
          placeholder="例如：高风险、中风险"
          disabled={!value.is_enabled}
          allowClear
          style={{ maxWidth: 480 }}
        />
      </Form.Item>

      <Form.Item
        label="人工复审流程模板"
        required={value.is_enabled}
        tooltip="选择已创建的人工审核策略（hr_ 前缀），素材按其阶段流转"
        style={{ marginBottom: 0 }}
      >
        <Select
          value={value.review_rule_id ?? undefined}
          onChange={(id) => patch({ review_rule_id: id ?? null })}
          placeholder={
            templates.length === 0
              ? loading
                ? '正在加载人工审核策略…'
                : '暂无可用人工审核策略，请先到「人工审核策略」页创建'
              : '选择人工审核策略'
          }
          disabled={!value.is_enabled}
          loading={loading}
          allowClear
          style={{ maxWidth: 480 }}
          options={templates.map((t) => ({
            value: t.id,
            label: `${t.name}（${t.code}）`,
          }))}
          notFoundContent={
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无可用人工审核策略，请先到「人工审核策略」页面创建
            </Text>
          }
        />
      </Form.Item>
    </Space>
  )
}
