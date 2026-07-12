/**
 * API client for /api/v1/admin/import-rules/*.
 *
 * Uses the main product `api` (axios) instance, which attaches the admin
 * JWT automatically. There is no bespoke auth.
 */
import { api } from './client'

export interface RuleImportChange {
  entity: 'item' | 'point'
  code: string
  item_code?: string | null
  label_cn: string
  description?: string | null
  action: 'create' | 'update' | 'skip'
  id?: number | null
}

export interface RuleImportSummary {
  items_created: number
  items_updated: number
  items_skipped: number
  points_created: number
  points_updated: number
  points_skipped: number
}

export interface RuleImportResult {
  package_code: string
  summary: RuleImportSummary
  changes: RuleImportChange[]
  warnings: string[]
  errors: string[]
}

export type RuleMediaType = 'text' | 'image'

export interface MediaTypeOption {
  value: RuleMediaType
  label: string
}

// Hardcoded — only two media types are supported today. Backend maps:
//   text  → text_audit_pro
//   image → image_audit_pro
export const MEDIA_TYPE_OPTIONS: MediaTypeOption[] = [
  { value: 'text', label: '文本规则（text_audit_pro）' },
  { value: 'image', label: '图片规则（image_audit_pro）' },
]

export interface RuleImportRequest {
  media_type: RuleMediaType
  table_text: string
  kind?: 'builtin' | 'personal'
  is_enabled?: boolean
  on_conflict?: 'update' | 'skip'
  confirm_downgrade?: boolean
  default_medium_threshold?: number | null
  default_high_threshold?: number | null
  default_risk_level?: '低风险' | '中风险' | '高风险' | null
}

export const adminImportRulesApi = {
  async preview(payload: RuleImportRequest): Promise<RuleImportResult> {
    const { data } = await api.post<RuleImportResult>(
      '/admin/import-rules/preview',
      payload,
    )
    return data
  },
  async import(payload: RuleImportRequest): Promise<RuleImportResult> {
    const { data } = await api.post<RuleImportResult>(
      '/admin/import-rules/import',
      payload,
    )
    return data
  },
}
