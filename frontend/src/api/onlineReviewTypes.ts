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

export interface OnlineReviewStrategyBrief {
  id: number
  name: string
}

export interface OnlineReviewResponse {
  conclusion: string
  log_id: number
  conclusionType: number
  data: OnlineReviewDataItem[]
  strategy: OnlineReviewStrategyBrief | null
  engines_used: string[]
  model: string | null
  llm_error: string | null
}

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------

export interface OnlineReviewLogListItem {
  id: number
  media_type: string
  conclusion: string
  conclusion_type: number
  risk_level: string
  model: string | null
  engines_used: string[]
  latency_ms: number
  input_preview: string
  strategy_id: number | null
  llm_error: string | null
  created_at: string
}

export interface OnlineReviewInputItem {
  kind: string
  name?: string
  text?: string
  // 图片/视频帧: storage_key 等 (后续扩展)
  [key: string]: unknown
}

export interface OnlineReviewLogDetail extends OnlineReviewLogListItem {
  hits: Array<Record<string, unknown>>
  correlation_id: string | null
  input_items: OnlineReviewInputItem[]
  user_id: number | null
}
