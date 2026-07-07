import { api } from './client'
import type { DesensitizeSpan } from '@/types/domain'

export interface DesensitizePreviewResponse {
  masked: string
  spans: DesensitizeSpan[]
  category: string | null
}

export interface MaskedHitOut {
  label: string | null
  label_cn: string | null
  category: string | null
  original: string
  masked: string
  spans: DesensitizeSpan[]
}

export interface MaskedBodyOut {
  original: string
  masked: string
  spans: DesensitizeSpan[]
}

export interface DesensitizeApplyResponse {
  task_id: number
  masked_hits: MaskedHitOut[]
  masked_body: MaskedBodyOut | null
  applied_at: string
}

export interface DesensitizationRule {
  id: number
  category: string
  pattern: string
  mask_template: string
  description: string | null
  enabled: boolean
  service_code: string | null
  created_at: string
  updated_at: string | null
}

export const desensitizationApi = {
  preview(text: string, whitelist: string[] = []) {
    return api
      .post<DesensitizePreviewResponse>('/desensitization/preview', { text, whitelist })
      .then((r) => r.data)
  },
  apply(taskId: number, whitelist: string[] = []) {
    return api
      .post<DesensitizeApplyResponse>('/desensitization/apply', {
        task_id: taskId,
        whitelist,
      })
      .then((r) => r.data)
  },
  listRules(serviceCode?: string) {
    return api
      .get<DesensitizationRule[]>('/desensitization/rules', {
        params: serviceCode ? { service_code: serviceCode } : undefined,
      })
      .then((r) => r.data)
  },
}