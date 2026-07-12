import { useMemo } from 'react'
import { Alert, Collapse, Space, Typography } from 'antd'
import { HumanReviewSettings } from '@/components/strategy/HumanReviewSettings'
import { EMPTY_HUMAN_REVIEW, extractHumanReview } from '@/types/domain'
import type { StrategyHumanReview } from '@/types/domain'

const { Text } = Typography

interface TaskDispositionOverridePanelProps {
  /** 当前选中的策略 ID（null 时仅显示空态提示） */
  strategyId?: number | null
  /** 策略的 step-3 默认值（从 Strategy.definition.human_review 解析） */
  strategyDefaultHumanReview?: Record<string, unknown> | null
  /** 任务级 override，undefined 或全空时表示「未启用覆盖」 */
  value?: Partial<StrategyHumanReview>
  onChange?: (next: Partial<StrategyHumanReview>) => void
}

/**
 * 「本任务处置覆盖」面板 —— 嵌入 CreateTaskPage 的「审核配置」Card。
 *
 * 用户可针对单个任务覆盖策略的 step-3 处置：
 * - 启用/关闭人审复审
 * - 升级人审的风险等级 / 敏感等级
 * - 抽审比例
 * - 流程模板
 * - 8 cell 处置覆盖
 *
 * 合并语义（由后端 merge_human_review 统一执行）：
 * - override 的非空字段覆盖 strategy；空字段走 strategy
 * - auto_action_overrides：深合并
 *
 * 未启用覆盖（value 为空对象）→ 提交时不出 override_human_review 字段，
 * 由后端走 strategy 默认值。
 */
export function TaskDispositionOverridePanel({
  strategyDefaultHumanReview,
  value,
  onChange,
}: TaskDispositionOverridePanelProps) {
  // 实际驱动 HumanReviewSettings 的本地 state；
  // 父组件只在用户点击「应用到本任务」后把 diff 写回 value
  const working = useMemo<StrategyHumanReview>(() => {
    if (value && Object.keys(value).length > 0) {
      return { ...EMPTY_HUMAN_REVIEW, ...value } as StrategyHumanReview
    }
    return EMPTY_HUMAN_REVIEW
  }, [value])

  const hasOverride = !!value && Object.keys(value).length > 0

  const strategySummary = useMemo(() => {
    const parsed = extractHumanReview(strategyDefaultHumanReview)
    if (!parsed.is_enabled) return '策略未启用人审复审（机审直接出结论）'
    return `策略默认：${parsed.risk_levels.join('、') || '无'}，抽审 ${parsed.sample_ratio ?? 100}%`
  }, [strategyDefaultHumanReview])

  if (!strategyDefaultHumanReview) {
    return (
      <Alert
        type="info"
        showIcon
        message="未选择策略时无法覆盖本任务处置"
        description="请先在上方「策略」中选择一个审核策略，然后展开本面板。"
      />
    )
  }

  return (
    <Collapse
      ghost
      items={[
        {
          key: 'override',
          label: (
            <Space size={6} align="center">
              <Text strong>高级：本任务处置覆盖</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {hasOverride ? '已自定义' : '默认走策略值'}
              </Text>
            </Space>
          ),
          children: (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message={strategySummary}
                description="下方任一字段非空即视为「启用覆盖」。留空则保留策略默认值。"
              />
              <HumanReviewSettings
                value={working}
                onChange={(next) => {
                  // 提取非默认字段（与 EMPTY_HUMAN_REVIEW 比较），只回传 diff
                  const diff: Partial<StrategyHumanReview> = {}
                  if (next.is_enabled !== EMPTY_HUMAN_REVIEW.is_enabled) {
                    diff.is_enabled = next.is_enabled
                  }
                  if (
                    next.risk_levels.length > 0 &&
                    next.risk_levels.join(',') !==
                      (EMPTY_HUMAN_REVIEW.risk_levels.join(',') || '')
                  ) {
                    diff.risk_levels = next.risk_levels
                  }
                  if (
                    next.sensitive_levels.length > 0 &&
                    next.sensitive_levels.join(',') !==
                      (EMPTY_HUMAN_REVIEW.sensitive_levels.join(',') || '')
                  ) {
                    diff.sensitive_levels = next.sensitive_levels
                  }
                  if (next.review_rule_id !== null) {
                    diff.review_rule_id = next.review_rule_id
                  }
                  if (
                    next.sample_ratio !== undefined &&
                    next.sample_ratio !== 100
                  ) {
                    diff.sample_ratio = next.sample_ratio
                  }
                  const ao = next.auto_action_overrides ?? {}
                  if (Object.keys(ao).length > 0) {
                    diff.auto_action_overrides = ao
                  }
                  onChange?.(diff)
                }}
              />
            </Space>
          ),
        },
      ]}
    />
  )
}