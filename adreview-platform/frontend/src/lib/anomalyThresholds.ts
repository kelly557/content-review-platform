export type AnomalySeverity = 'warn' | 'critical'

export interface AnomalyThreshold {
  rule_code: string
  label: string
  metric: string
  threshold: number
  severity: AnomalySeverity
  unit: '%' | 'count'
  description: string
  source: 'default' | 'custom'
}

export const ANOMALY_RULE_CODES = {
  REJECT_RATE: 'reject_rate_high',
  HIGH_RISK_CONTENT: 'high_risk_content_high',
  HIGH_RISK_ACCOUNT: 'high_risk_account_concentration',
} as const

export type AnomalyRuleCode =
  (typeof ANOMALY_RULE_CODES)[keyof typeof ANOMALY_RULE_CODES]

export const DEFAULT_ANOMALY_THRESHOLDS: Record<AnomalyRuleCode, AnomalyThreshold> = {
  [ANOMALY_RULE_CODES.REJECT_RATE]: {
    rule_code: ANOMALY_RULE_CODES.REJECT_RATE,
    label: '拒绝率异常',
    metric: '拒绝率',
    threshold: 30,
    severity: 'warn',
    unit: '%',
    description: '拒绝率过高',
    source: 'default',
  },
  [ANOMALY_RULE_CODES.HIGH_RISK_CONTENT]: {
    rule_code: ANOMALY_RULE_CODES.HIGH_RISK_CONTENT,
    label: '高风险内容异常',
    metric: '1h 高风险内容数',
    threshold: 50,
    severity: 'critical',
    unit: 'count',
    description: '1 小时内高风险内容数量过多',
    source: 'default',
  },
  [ANOMALY_RULE_CODES.HIGH_RISK_ACCOUNT]: {
    rule_code: ANOMALY_RULE_CODES.HIGH_RISK_ACCOUNT,
    label: '高风险账号聚集',
    metric: '1h 高风险账号数',
    threshold: 20,
    severity: 'critical',
    unit: 'count',
    description: '1 小时内高风险账号聚集',
    source: 'default',
  },
}

export const SEVERITY_TAG_COLOR: Record<AnomalySeverity, string> = {
  warn: 'orange',
  critical: 'red',
}

export const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  warn: '预警',
  critical: '严重',
}
