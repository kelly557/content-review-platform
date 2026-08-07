// 阈值 + 启用 状态组合。前端存 localStorage, 后端 anomaly_scanner 内部有自己的
// DEFAULT_RULES, 此处仅驱动 UI 上的"是否启用"显示 + 阈值展示。报警事件本身的
// 生成由后端 scanner 决定。
//
// v3 形态: 严重程度拆成 critical / warn 两个独立结构化对象, 附加条件
// 改成多行 AND 条件列表. v2 形态 (critical_threshold / warn_threshold / extra_condition)
// 不可直接套用, 兜底 DEFAULT.

export type ThresholdOperator = '>' | '<' | '>=' | '<=' | '='
export type ThresholdUnit = '%' | 'count'

export interface AnomalyThresholdPart {
  operator: ThresholdOperator
  value: number
  unit: ThresholdUnit
}

export const THRESHOLD_OPERATORS: ThresholdOperator[] = ['>', '<', '>=', '<=', '=']

export const EXTRA_FIELDS = [
  { value: 'request_count', label: '请求数' },
  { value: 'account_count', label: '账号数' },
] as const

export type ExtraFieldCode = (typeof EXTRA_FIELDS)[number]['value']

export interface AnomalyExtraCondition {
  field: ExtraFieldCode
  operator: ThresholdOperator
  value: number
}

export interface AnomalyThreshold {
  rule_code: string
  label: string
  metric: string
  dimension: '审核模态' | '策略名称' | '渠道' | '全局' | string
  algorithm: '固定阈值' | string
  window_label: '近 1 小时' | '近 24 小时' | '近 7 日' | string
  critical: AnomalyThresholdPart
  warn: AnomalyThresholdPart
  extra_conditions: AnomalyExtraCondition[]
  /** 兼容旧字段, 取 critical.value */
  threshold: number
  /** 兼容旧字段, 取 critical.unit */
  unit: ThresholdUnit
  description: string
  enabled: boolean
  source: 'default' | 'custom'
}

export const ANOMALY_RULE_CODES = {
  REJECT_RATE: 'reject_rate_high',
  HIGH_RISK_CONTENT: 'high_risk_content_high',
  HIGH_RISK_ACCOUNT: 'high_risk_account_concentration',
} as const

export type AnomalyRuleCode =
  (typeof ANOMALY_RULE_CODES)[keyof typeof ANOMALY_RULE_CODES]

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThreshold[] = [
  {
    rule_code: ANOMALY_RULE_CODES.REJECT_RATE,
    label: '拒绝率异常',
    metric: '拒绝率',
    dimension: '审核模态',
    algorithm: '固定阈值',
    window_label: '近 1 小时',
    critical: { operator: '>', value: 5, unit: '%' },
    warn: { operator: '>', value: 3, unit: '%' },
    extra_conditions: [],
    threshold: 5,
    unit: '%',
    description: '拒绝率过高',
    enabled: true,
    source: 'default',
  },
  {
    rule_code: ANOMALY_RULE_CODES.HIGH_RISK_CONTENT,
    label: '账号高风险阻断异常',
    metric: '高风险阻断密度',
    dimension: '全局',
    algorithm: '固定阈值',
    window_label: '近 1 小时',
    critical: { operator: '>', value: 30, unit: '%' },
    warn: { operator: '>', value: 20, unit: '%' },
    extra_conditions: [{ field: 'request_count', operator: '>', value: 20 }],
    threshold: 30,
    unit: '%',
    description: '1 小时内高风险账号阻断过多',
    enabled: true,
    source: 'default',
  },
  {
    rule_code: ANOMALY_RULE_CODES.HIGH_RISK_ACCOUNT,
    label: '高风险账号聚集异常',
    metric: '高风险账号密度',
    dimension: '全局',
    algorithm: '固定阈值',
    window_label: '近 1 小时',
    critical: { operator: '>', value: 50, unit: '%' },
    warn: { operator: '>', value: 30, unit: '%' },
    extra_conditions: [{ field: 'account_count', operator: '>', value: 5 }],
    threshold: 50,
    unit: '%',
    description: '1 小时内高风险账号聚集',
    enabled: true,
    source: 'default',
  },
]

export const WINDOW_LABEL_OPTIONS = ['近 1 小时', '近 24 小时', '近 7 日'] as const
export const DIMENSION_OPTIONS = ['全局', '审核模态', '策略名称', '渠道'] as const
export const ALGORITHM_OPTIONS = ['固定阈值'] as const
export const THRESHOLD_UNIT_OPTIONS = ['%', 'count'] as const

export function renderPart(part: AnomalyThresholdPart): string {
  return `${part.operator} ${part.value}${part.unit}`
}

export function findExtraFieldLabel(value: string): string {
  return EXTRA_FIELDS.find((f) => f.value === value)?.label ?? value
}
