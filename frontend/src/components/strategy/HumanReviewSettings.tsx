import { useEffect, useState } from 'react'
import {
  Alert,
  Checkbox,
  Form,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { workflowsApi } from '@/api/workflows'
import {
  EMPTY_HUMAN_REVIEW,
  SENSITIVE_LEVEL_OPTIONS,
  STRATEGY_RISK_LEVEL_OPTIONS,
  type AutoAction,
  type AutoActionOverrides,
  type StrategyHumanReview,
  type StrategyRiskLevel,
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
      risk_levels:
        value.risk_levels.length > 0 ? value.risk_levels : ['高风险'],
      sensitive_levels: value.sensitive_levels,
      review_rule_id: value.review_rule_id,
      auto_action_overrides: value.auto_action_overrides ?? {},
      sample_ratio: value.sample_ratio ?? 100,
    })
  }

  const riskOptions = STRATEGY_RISK_LEVEL_OPTIONS
  const sensitiveOptions = SENSITIVE_LEVEL_OPTIONS.filter((o) => o.value !== 'S0')

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
                ? '已开启 — 下方配置升级到人工复审的规则'
                : '已关闭 — 机审按风险等级 + 敏感等级直接出结论'}
            </Text>
          </Space>
        </Form.Item>
      </div>

      {/* 关人审（默认）：显示可编辑的处置预览表 */}
      {!value.is_enabled && (
        <EditableDispositionTable
          overrides={value.auto_action_overrides ?? {}}
          onChange={(next) => patch({ auto_action_overrides: next })}
        />
      )}

      {/* 开人审：显示风险 / 敏感 / 流程模板 */}
      {value.is_enabled && (
        <>
          <Form.Item
            label="升级人审的机审风险等级"
            required
            tooltip="机审结果出现下列风险等级时升级到人工复审。策略级选择优先于 service 默认设置。"
            style={{ marginBottom: 0 }}
          >
            <Checkbox.Group
              value={value.risk_levels}
              onChange={(v) => patch({ risk_levels: v as StrategyRiskLevel[] })}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
            >
              {riskOptions.map((o) => (
                <Checkbox key={o.value} value={o.value}>
                  <Tag color={o.color} bordered={false}>
                    {o.label}
                  </Tag>
                </Checkbox>
              ))}
            </Checkbox.Group>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              勾选的风险等级出现时，机审结果升级到人工复审。
            </Text>
          </Form.Item>

          <Form.Item
            label="升级人审的敏感等级"
            required={value.risk_levels.includes('敏感')}
            tooltip="仅当机审结果为「敏感」时生效。S1 永远走脱敏放行（不升级人审）；勾选 S2/S3 即升级人审。"
            style={{ marginBottom: 0 }}
          >
            <Checkbox.Group
              value={value.sensitive_levels}
              onChange={(v) => patch({ sensitive_levels: v as never })}
              disabled={!value.risk_levels.includes('敏感')}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
            >
              {sensitiveOptions.map((o) => (
                <Checkbox key={o.value} value={o.value}>
                  <Tag color={o.color} bordered={false}>
                    {o.label}
                  </Tag>
                </Checkbox>
              ))}
            </Checkbox.Group>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              仅当机审结果为「敏感」时生效。S1 永远走脱敏放行（不升级人审）；
              勾选 S2/S3 即升级人审。
            </Text>
          </Form.Item>

          <Form.Item
            label="抽审比例"
            tooltip="在符合升级条件的素材中按此比例抽样进入人审。未抽中的素材按默认矩阵处理（高/中风险拒绝，低风险/敏感 S0 通过；敏感 S1 脱敏放行）。100% = 全部升级（默认）。"
            style={{ marginBottom: 0 }}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Slider
                min={0}
                max={100}
                step={1}
                value={value.sample_ratio ?? 100}
                onChange={(v) => patch({ sample_ratio: v })}
                marks={{ 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '全部升级' }}
                tooltip={{ formatter: (v) => `${v}%` }}
                style={{ maxWidth: 520 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                预估：每 100 条触发升级的素材，约 {value.sample_ratio ?? 100}{' '}
                条进入人工复审。抽样基于素材 ID 确定性计算，结论稳定可复现。
              </Text>
            </Space>
          </Form.Item>

          <Form.Item
            label="人工复审流程模板"
            required
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
        </>
      )}
    </Space>
  )
}

// ── 关人审时：可编辑的处置预览表 ──────────────────────────────────────────────

interface EditableCell {
  key: string
  riskLabel: string
  sensitiveLabel: string
  /** 默认（系统内置）动作标签 */
  defaultLabel: string
  defaultColor: string
}

const ACTION_META: Record<
  AutoAction,
  { label: string; color: string }
> = {
  approved: { label: '通过', color: 'green' },
  rejected: { label: '拒绝', color: 'volcano' },
  desensitize: { label: '脱敏放行', color: 'gold' },
  review: { label: '升级人审', color: 'gold' },
}

const EDITABLE_CELLS: EditableCell[] = [
  { key: '高风险|—', riskLabel: '高风险', sensitiveLabel: '—', defaultLabel: '拒绝', defaultColor: 'volcano' },
  { key: '中风险|—', riskLabel: '中风险', sensitiveLabel: '—', defaultLabel: '拒绝', defaultColor: 'volcano' },
  { key: '敏感|S3',  riskLabel: '敏感',   sensitiveLabel: 'S3 重度', defaultLabel: '拒绝', defaultColor: 'volcano' },
  { key: '敏感|S2',  riskLabel: '敏感',   sensitiveLabel: 'S2 中度', defaultLabel: '拒绝', defaultColor: 'volcano' },
  { key: '敏感|S1',  riskLabel: '敏感',   sensitiveLabel: 'S1 轻度', defaultLabel: '脱敏放行', defaultColor: 'gold' },
  { key: '敏感|—',   riskLabel: '敏感',   sensitiveLabel: 'S0 未检出', defaultLabel: '通过', defaultColor: 'green' },
  { key: '低风险|—', riskLabel: '低风险', sensitiveLabel: '—', defaultLabel: '通过', defaultColor: 'green' },
  { key: '无风险|—', riskLabel: '无风险', sensitiveLabel: '—', defaultLabel: '通过', defaultColor: 'green' },
]

function EditableDispositionTable({
  overrides,
  onChange,
}: {
  overrides: AutoActionOverrides
  onChange: (next: AutoActionOverrides) => void
}) {
  const setCell = (key: string, action: AutoAction | null) => {
    const next = { ...overrides }
    if (action === null) {
      delete next[key]
    } else {
      next[key] = action
    }
    onChange(next)
  }

  const columns: ColumnsType<EditableCell> = [
    {
      title: '风险 / 敏感',
      key: 'risk',
      width: '40%',
      render: (_v, row) => (
        <Space size={6}>
          <Text strong>{row.riskLabel}</Text>
          {row.sensitiveLabel !== '—' && (
            <Tag bordered={false} color="default">{row.sensitiveLabel}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '动作（点击可改）',
      key: 'action',
      render: (_v, row) => {
        const userAction = overrides[row.key]
        const isCustomized = userAction !== undefined
        const current: { label: string; color: string } = isCustomized
          ? ACTION_META[userAction]
          : { label: `默认（${row.defaultLabel}）`, color: row.defaultColor }
        return (
          <Select<AutoAction | 'default'>
            value={isCustomized ? userAction : 'default'}
            style={{ minWidth: 160 }}
            onChange={(v) => setCell(row.key, v === 'default' ? null : v)}
            options={[
              { value: 'default', label: `默认（${row.defaultLabel}）` },
              { value: 'approved', label: '通过' },
              { value: 'rejected', label: '拒绝' },
              { value: 'desensitize', label: '脱敏放行' },
            ]}
            optionRender={(o) => (
              <Space size={4}>
                {o.value !== 'default' && (
                  <Tag color={ACTION_META[o.value as AutoAction].color} bordered={false}>
                    {ACTION_META[o.value as AutoAction].label}
                  </Tag>
                )}
                <Text>{o.label}</Text>
              </Space>
            )}
            labelRender={() => (
              <Space size={4}>
                <Tag color={current.color} bordered={false}>
                  {current.label}
                </Tag>
                {isCustomized && (
                  <Tooltip title={`已自定义（系统默认：${row.defaultLabel}）`}>
                    <ExclamationCircleOutlined style={{ color: '#F59E0B', fontSize: 12 }} />
                  </Tooltip>
                )}
              </Space>
            )}
          />
        )
      },
    },
  ]

  return (
    <Alert
      type="info"
      showIcon
      style={{ background: 'transparent', border: '1px solid #E2E8F0' }}
      message={<Text strong>处置预览（可编辑）</Text>}
      description={
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            关闭人审时，机审节点直接出终态结论。点击每行「动作」下拉可自定义处置。
            选「默认」= 由机审内置矩阵决定（推荐保留默认）。系统默认：
            高/中/敏感 S2/S3 拒绝，敏感 S1 脱敏放行，敏感 S0/低/无风险 通过。
          </Text>
          <Table<EditableCell>
            rowKey="key"
            dataSource={EDITABLE_CELLS}
            columns={columns}
            pagination={false}
            size="small"
          />
        </Space>
      }
    />
  )
}
