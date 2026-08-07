import { api } from './client'
import type { AnomalyThreshold } from '@/lib/anomalyThresholds'

interface AlertRuleDto {
  id: number
  rule_code: string
  label: string
  metric: string
  dimension: string
  algorithm: string
  window_label: string
  critical: { operator: string; value: number; unit: string } | null
  warn: { operator: string; value: number; unit: string } | null
  extra_conditions: { field: string; operator: string; value: number }[] | null
  description: string | null
  enabled: boolean
  source: string
}

function toThreshold(r: AlertRuleDto): AnomalyThreshold {
  const critical = r.critical ?? { operator: '>', value: 0, unit: '%' }
  return {
    rule_code: r.rule_code,
    label: r.label,
    metric: r.metric,
    dimension: r.dimension,
    algorithm: r.algorithm,
    window_label: r.window_label,
    critical: critical as AnomalyThreshold['critical'],
    warn: (r.warn ?? { operator: '>', value: 0, unit: '%' }) as AnomalyThreshold['warn'],
    extra_conditions: (r.extra_conditions ?? []) as AnomalyThreshold['extra_conditions'],
    threshold: critical.value,
    unit: critical.unit as AnomalyThreshold['unit'],
    description: r.description ?? '',
    enabled: r.enabled,
    source: r.source as 'default' | 'custom',
  }
}

export const alertRulesApi = {
  list(): Promise<AnomalyThreshold[]> {
    return api.get<AlertRuleDto[]>('/alerts/rules').then((r) => r.data.map(toThreshold))
  },
  update(ruleCode: string, patch: Partial<AnomalyThreshold>) {
    const body: Record<string, unknown> = {}
    if (patch.label !== undefined) body.label = patch.label
    if (patch.critical !== undefined) body.critical = patch.critical
    if (patch.warn !== undefined) body.warn = patch.warn
    if (patch.extra_conditions !== undefined) body.extra_conditions = patch.extra_conditions
    if (patch.description !== undefined) body.description = patch.description
    if (patch.enabled !== undefined) body.enabled = patch.enabled
    return api.put<AlertRuleDto>(`/alerts/rules/${encodeURIComponent(ruleCode)}`, body).then((r) => toThreshold(r.data))
  },
  create(rule: AnomalyThreshold) {
    return api
      .post<AlertRuleDto>('/alerts/rules', {
        rule_code: rule.rule_code,
        label: rule.label,
        metric: rule.metric,
        dimension: rule.dimension,
        algorithm: rule.algorithm,
        window_label: rule.window_label,
        critical: rule.critical,
        warn: rule.warn,
        extra_conditions: rule.extra_conditions,
        description: rule.description,
        enabled: rule.enabled,
        source: 'custom',
      })
      .then((r) => toThreshold(r.data))
  },
  delete(ruleCode: string) {
    return api.delete(`/alerts/rules/${encodeURIComponent(ruleCode)}`).then((r) => r.data)
  },
}
