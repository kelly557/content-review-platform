import { api } from './client'
import type { DetectionRule, HumanReviewConfig, RiskLevel, WordSetOption } from '@/types/domain'

export const detectionRulesApi = {
  list(serviceCode: string) {
    return api
      .get<DetectionRule[]>(`/services/${encodeURIComponent(serviceCode)}/rules`)
      .then((r) => r.data)
  },
  update(
    serviceCode: string,
    label: string,
    body: {
      medium_threshold?: number
      high_threshold?: number
      scope_text?: string
      is_enabled?: boolean
      custom_wordset_id?: number | null
    },
  ) {
    return api
      .put<DetectionRule>(
        `/services/${encodeURIComponent(serviceCode)}/rules/${encodeURIComponent(label)}`,
        body,
      )
      .then((r) => r.data)
  },
  reset(serviceCode: string) {
    return api
      .post<{ items: DetectionRule[] }>(
        `/services/${encodeURIComponent(serviceCode)}/rules/reset`,
      )
      .then((r) => r.data)
  },
  listWordsets(serviceCode: string) {
    return api
      .get<WordSetOption[]>(
        `/services/${encodeURIComponent(serviceCode)}/rules/wordsets`,
      )
      .then((r) => r.data)
  },
  getHumanReview(serviceCode: string) {
    return api
      .get<HumanReviewConfig>(
        `/services/${encodeURIComponent(serviceCode)}/human-review`,
      )
      .then((r) => r.data)
  },
  updateHumanReview(
    serviceCode: string,
    body: {
      is_enabled?: boolean
      risk_levels?: RiskLevel[]
      review_rule_id?: number | null
      notify_plan_id?: number | null
    },
  ) {
    return api
      .put<HumanReviewConfig>(
        `/services/${encodeURIComponent(serviceCode)}/human-review`,
        body,
      )
      .then((r) => r.data)
  },
  copyRulesFrom(targetServiceCode: string, sourceServiceCode: string) {
    return api
      .post<DetectionRule[]>(
        `/services/${encodeURIComponent(targetServiceCode)}/rules/copy-from`,
        { source_service_code: sourceServiceCode },
      )
      .then((r) => r.data)
  },
}
