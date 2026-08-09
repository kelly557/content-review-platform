import type { MaterialType } from '@/types/domain'

/** 在线审核请求摘要（展示用） */
export interface OnlineReviewRequestItem {
  index: number
  kind: 'file' | 'text'
  name: string
  size?: number
  mime?: string
  text_snippet?: string
}

export interface OnlineReviewRequest {
  strategy_id: number | null
  strategy_name?: string
  backendType: MaterialType
  detection_mode: 'single' | 'bulk'
  item_count: number
  submitted_at: string
  items: OnlineReviewRequestItem[]
}

export interface OnlineReviewHit {
  source: string
  position?: number
  matched_text?: string
  risk_level: string
  rule_code: string
  rule_label: string
}

export interface OnlineReviewDataItem {
  msg: string
  conclusion: string
  hits: OnlineReviewHit[]
}

export interface OnlineReviewResponse {
  conclusion: string
  log_id: number
  phoneRisk: Record<string, never>
  isHitMd5: boolean
  conclusionType: number
  data: OnlineReviewDataItem[]
}
