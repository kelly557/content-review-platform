import { useEffect, useState } from 'react'
import {
  Alert,
  Checkbox,
  Descriptions,
  Form,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ScissorOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { workflowsApi } from '@/api/workflows'
import {
  DEFAULT_DISPOSITION_PREVIEW,
  EMPTY_HUMAN_REVIEW,
  HUMAN_ON_DISPOSITION_PREVIEW,
  SENSITIVE_LEVEL_OPTIONS,
  STRATEGY_RISK_LEVEL_OPTIONS,
  type DispositionRow,
  type StrategyHumanReview,
  type StrategyRiskLevel,
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

type PreviewMode = 'off' | 'on'

export function HumanReviewSettings({ value, onChange }: HumanReviewSettingsProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('off')

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
      risk_levels:
        value.risk_levels.length > 0 ? value.risk_levels : ['高风险'],
      sensitive_levels: value.sensitive_levels,
      review_rule_id: value.review_rule_id,
    })
  }

  const riskOptions = STRATEGY_RISK_LEVEL_OPTIONS
  const sensitiveOptions = SENSITIVE_LEVEL_OPTIONS.filter((o) => o.value !== 'S0')

  const riskHitSet = new Set<StrategyRiskLevel>(value.risk_levels)
  const sensitiveHitSet = new Set(value.sensitive_levels)

  const renderRiskTag = (risk: StrategyRiskLevel) => {
    const opt = riskOptions.find((o) => o.value === risk)
    if (!opt) return risk
    const tag = (
      <Tag color={opt.color} bordered={false}>
        {opt.label}
      </Tag>
    )
    if (!opt.escalateRequiresRecall) return tag
    return (
      <Space size={4}>
        {tag}
        <Tooltip title="该档位升级人审还需 service 同时开启「召回模式」">
          <ExclamationCircleOutlined style={{ color: '#F59E0B' }} />
        </Tooltip>
      </Space>
    )
  }

  const renderSensitiveTag = (s: string) => {
    const opt = SENSITIVE_LEVEL_OPTIONS.find((o) => o.value === s)
    if (!opt) return s
    const tag = (
      <Tag color={opt.color} bordered={false}>
        {opt.label}
      </Tag>
    )
    if (s === 'S1') {
      return (
        <Space size={4}>
          {tag}
          <Tooltip title="S1 永远走脱敏放行（不升级人审）">
            <ExclamationCircleOutlined style={{ color: '#F59E0B' }} />
          </Tooltip>
        </Space>
      )
    }
    return tag
  }

  const highlightRow = (row: DispositionRow): boolean => {
    if (!value.is_enabled || previewMode !== 'on') return false
    if (row.risk === '敏感') {
      return row.sensitive !== '—' && sensitiveHitSet.has(row.sensitive as never)
    }
    return riskHitSet.has(row.risk as StrategyRiskLevel)
  }

  const renderPreviewItems = (rows: ReadonlyArray<DispositionRow>) =>
    rows.map((row) => ({
      key: `${row.risk}-${row.sensitive}`,
      label: (
        <Space size={6}>
          {row.risk === '敏感' ? (
            renderSensitiveTag(row.sensitive as string)
          ) : (
            <Text strong>{renderRiskTag(row.risk as StrategyRiskLevel)}</Text>
          )}
          {row.risk !== '敏感' && row.sensitive !== '—' && (
            <Tag bordered={false}>{row.sensitive}</Tag>
          )}
        </Space>
      ),
      children: (
        <Space size={8} align="center">
          <Tag
            color={row.statusColor}
            icon={row.iconName ? ICON_MAP[row.iconName] : undefined}
            style={
              highlightRow(row)
                ? { boxShadow: '0 0 0 2px #16A34A' }
                : undefined
            }
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
    }))

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

      <Form.Item
        label="升级人审的机审风险等级"
        required={value.is_enabled}
        tooltip="机审结果出现下列风险等级时升级到人工复审。「低风险」/「敏感」档位还需 service 同时开启「召回模式」。"
        style={{ marginBottom: 0 }}
      >
        <Checkbox.Group
          value={value.risk_levels}
          onChange={(v) => patch({ risk_levels: v as StrategyRiskLevel[] })}
          disabled={!value.is_enabled}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
        >
          {riskOptions.map((o) => (
            <Checkbox key={o.value} value={o.value}>
              <Space size={4}>
                <Tag color={o.color} bordered={false}>
                  {o.label}
                </Tag>
                {o.escalateRequiresRecall && (
                  <Tooltip title="该档位升级人审还需 service 同时开启「召回模式」">
                    <ExclamationCircleOutlined
                      style={{ color: '#F59E0B', fontSize: 12 }}
                    />
                  </Tooltip>
                )}
              </Space>
            </Checkbox>
          ))}
        </Checkbox.Group>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          勾选的风险等级出现时，机审结果升级到人工复审。
          「低风险」/「敏感」档位升级还需 service 同时开启「召回模式」。
        </Text>
      </Form.Item>

      <Form.Item
        label="升级人审的敏感等级"
        required={value.is_enabled && value.risk_levels.includes('敏感')}
        tooltip="仅当机审结果为「敏感」时生效。S1 永远走脱敏放行（不升级人审）；S2/S3 升级人审还需 service 开启「召回模式」。"
        style={{ marginBottom: 0 }}
      >
        <Checkbox.Group
          value={value.sensitive_levels}
          onChange={(v) => patch({ sensitive_levels: v as never })}
          disabled={
            !value.is_enabled || !value.risk_levels.includes('敏感')
          }
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
        >
          {sensitiveOptions.map((o) => (
            <Checkbox key={o.value} value={o.value}>
              <Space size={4}>
                <Tag color={o.color} bordered={false}>
                  {o.label}
                </Tag>
                {o.value === 'S1' && (
                  <Tooltip title="S1 永远走脱敏放行（不升级人审）">
                    <ExclamationCircleOutlined
                      style={{ color: '#F59E0B', fontSize: 12 }}
                    />
                  </Tooltip>
                )}
                {(o.value === 'S2' || o.value === 'S3') && (
                  <Tooltip title="升级还需 service 开启「召回模式」">
                    <ExclamationCircleOutlined
                      style={{ color: '#F59E0B', fontSize: 12 }}
                    />
                  </Tooltip>
                )}
              </Space>
            </Checkbox>
          ))}
        </Checkbox.Group>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          仅当机审结果为「敏感」时生效。S1 永远走脱敏放行（不升级人审）；
          S2/S3 升级还需 service 开启「召回模式」。
        </Text>
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

      <Alert
        type="info"
        showIcon
        style={{ background: 'transparent', border: '1px solid #E2E8F0' }}
        message={
          <Space wrap>
            <Text strong>处置预览</Text>
            <Segmented
              size="small"
              value={previewMode}
              onChange={(v) => setPreviewMode(v as PreviewMode)}
              options={[
                { label: '关人审（默认）', value: 'off' },
                { label: '开人审 + 当前选项', value: 'on' },
              ]}
            />
          </Space>
        }
        description={
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {previewMode === 'off'
                ? '机审节点直接出终态结论，不再走人工复审：'
                : value.is_enabled
                  ? '绿色描边 = 你当前的选择会升级到人审 / 脱敏放行 / 通过；其他 cell 走默认动作。'
                  : '请先打开「启用人审复审」开关，此模式下才能高亮显示你选择的升级 cell。'}
            </Text>
            <Descriptions
              size="small"
              column={1}
              bordered
              items={
                previewMode === 'off'
                  ? renderPreviewItems(DEFAULT_DISPOSITION_PREVIEW)
                  : renderPreviewItems(HUMAN_ON_DISPOSITION_PREVIEW)
              }
            />
          </Space>
        }
      />
    </Space>
  )
}
