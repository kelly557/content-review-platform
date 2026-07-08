import {
  Alert,
  Descriptions,
  Form,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  ScissorOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { workflowsApi } from '@/api/workflows'
import {
  DEFAULT_DISPOSITION_PREVIEW,
  EMPTY_HUMAN_REVIEW,
  STRATEGY_RISK_LEVEL_OPTIONS,
  type DispositionRow,
  type StrategyHumanReview,
  type WorkflowTemplate,
} from '@/types/domain'

const { Text } = Typography

interface HumanReviewSettingsProps {
  value: StrategyHumanReview
  onChange: (next: StrategyHumanReview) => void
}

const ICON_MAP = {
  stop: <StopOutlined />,
  scissor: <ScissorOutlined />,
  check: <CheckCircleOutlined />,
} as const

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
          tooltip="关闭后机审按风险等级 + 敏感等级直接出结论。仅低风险/无风险/敏感-S0 通过；中风险与敏感 S2/S3 拒绝；敏感 S1 脱敏放行。不会升级人工复审。"
          style={{ marginBottom: 0 }}
        >
          <Space>
            <Switch checked={value.is_enabled} onChange={onToggle} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {value.is_enabled
                ? '已开启 — 机审按下方配置升级到人工复审'
                : '已关闭 — 机审按风险等级 + 敏感等级直接出结论'}
            </Text>
          </Space>
        </Form.Item>
      </div>

      {!value.is_enabled && (
        <Alert
          type="info"
          showIcon
          style={{
            background: 'transparent',
            border: '1px solid #E2E8F0',
          }}
          message="关闭状态下的处置预览"
          description={
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                机审节点直接出终态结论，不再走人工复审：
              </Text>
              <Descriptions
                size="small"
                column={1}
                bordered
                items={[...DEFAULT_DISPOSITION_PREVIEW].map(
                  (row: DispositionRow) => ({
                    key: `${row.risk}-${row.sensitive}`,
                    label: (
                      <Space size={6}>
                        <Text strong>{row.risk}</Text>
                        {row.sensitive !== '—' && (
                          <Tag bordered={false}>{row.sensitive}</Tag>
                        )}
                      </Space>
                    ),
                    children: (
                      <Space size={8} align="center">
                        <Tag
                          color={row.statusColor}
                          icon={row.iconName ? ICON_MAP[row.iconName] : undefined}
                        >
                          {row.statusLabel}
                        </Tag>
                        {row.note && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {row.note}
                          </Text>
                        )}
                      </Space>
                    ),
                  })
                )}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                开启人审复审并选择风险等级后，被选中的等级会升级到人工复审；高/中风险 + 敏感 S2/S3 在人审开+召回模式下也可升级人审。人审结论决定最终结果。
              </Text>
            </Space>
          }
        />
      )}

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
