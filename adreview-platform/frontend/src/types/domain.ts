import type { UserRole } from './auth'
export type { User, UserRole } from './auth'

export type MaterialType = 'image' | 'video' | 'pdf' | 'text'
export type MaterialStatus = 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn'
export type ReviewDecision = 'pending' | 'approved' | 'rejected' | 'returned'
export type ReviewType = 'machine' | 'human'
export type MachineStatus = 'pending' | 'running' | 'completed' | 'failed'
export type PackageStatus = 'draft' | 'submitted' | 'in_review' | 'completed'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface MaterialVersion {
  id: number
  material_id: number
  version_no: number
  original_filename: string
  mime_type: string
  file_size: number
  text_body?: string | null
  created_at: string
  download_url?: string
}

export interface Material {
  id: number
  title: string
  description?: string | null
  material_type: MaterialType
  status: MaterialStatus
  submitter_id: number
  current_version_id?: number | null
  tags: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  versions: MaterialVersion[]
}

export interface MaterialListItem {
  id: number
  title: string
  material_type: MaterialType
  status: MaterialStatus
  submitter_id: number
  current_version_id?: number | null
  updated_at: string
}

export interface MaterialCreatePayload {
  title: string
  description?: string
  material_type: MaterialType
  tags?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ReviewAssignment {
  id: number
  task_id: number
  assignee_id: number
  decision: ReviewDecision
  note?: string | null
  decided_at?: string | null
}

export interface ReviewComment {
  id: number
  task_id: number
  author_id: number
  body: string
  created_at: string
}

export interface ReviewTask {
  id: number
  material_id: number
  material_version_id: number
  workflow_instance_id: number
  stage_key: string
  title: string
  review_type: ReviewType
  final_decision: ReviewDecision
  machine_status?: MachineStatus | null
  machine_result?: Record<string, unknown> | null
  machine_started_at?: string | null
  machine_completed_at?: string | null
  created_at: string
  completed_at?: string | null
  assignments: ReviewAssignment[]
  comments: ReviewComment[]
  agent_review?: AgentReviewResult | null
}

export type AgentRiskLevel = '高风险' | '中风险' | '低风险' | '无风险'

export interface AgentHit {
  service_code: string
  service_name?: string | null
  label: string
  label_cn: string
  score: number
  quote?: string | null
  bbox?: { x: number; y: number; w: number; h: number } | null
  page?: number | null
  timestamp_ms?: number | null
}

export interface AgentStrategyRef {
  id: number
  code: string
  name: string
}

export interface AgentRuleHit {
  rule_id: number
  label: string
  label_cn: string
  threshold: number
  matched: boolean
}

export interface AgentReviewResult {
  risk_level: AgentRiskLevel
  finished_at: string
  hits: AgentHit[]
  rule_hits: AgentRuleHit[]
  strategy?: AgentStrategyRef | null
  summary?: string | null
}

export interface MaterialPackageItem {
  id: number
  package_id: number
  material_id: number
  position: number
  review_task_id: number | null
  material: Material | null
}

export interface MaterialPackage {
  id: number
  name: string
  description: string | null
  material_type: string
  status: PackageStatus
  creator_id: number
  created_at: string
  updated_at: string
  items: MaterialPackageItem[]
}

export interface MaterialPackageListItem {
  id: number
  name: string
  material_type: string
  status: PackageStatus
  creator_id: number
  created_at: string
  updated_at: string
  item_count: number
}

export interface MaterialPackageCreatePayload {
  name: string
  description?: string
  material_type: string
  material_ids: number[]
}

export interface MaterialPackageUpdatePayload {
  name?: string
  description?: string
  material_ids?: number[]
}

export interface Annotation {
  id: number
  material_version_id: number
  author_id: number
  page?: number | null
  frame?: number | null
  timestamp_ms?: number | null
  x?: number | null
  y?: number | null
  w?: number | null
  h?: number | null
  shape?: Record<string, unknown> | null
  quote?: string | null
  body: string
  parent_id?: number | null
  resolved: boolean
  created_at: string
  updated_at?: string | null
}

export interface WorkflowNode {
  id: number
  position: number
  stage_key: string
  name: string
  required_role: string
  mode: string
  status: string
}

export interface WorkflowInstance {
  id: number
  material_id: number
  material_version_id: number
  template_id: number
  state: string
  current_stage_key?: string | null
  created_at: string
  completed_at?: string | null
  nodes: WorkflowNode[]
}

export interface WorkflowTemplate {
  id: number
  code: string
  name: string
  description?: string | null
  definition: { stages: Array<{ key: string; name: string; role: string; mode: string }> }
  is_active: boolean
}

export interface OverviewStats {
  total_materials: number
  in_review: number
  approved: number
  rejected: number
  avg_review_hours: number | null
}

export const ROLE_LABELS: Record<UserRole, string> = {
  submitter: '提交者',
  reviewer: '审核员',
  mlr: 'MLR 专家',
  admin: '管理员',
}

export const STATUS_LABELS: Record<MaterialStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  in_review: '审核中',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
}

export const STATUS_COLORS: Record<MaterialStatus, string> = {
  draft: 'default',
  submitted: 'processing',
  in_review: 'processing',
  approved: 'success',
  rejected: 'error',
  withdrawn: 'default',
}

export const TYPE_LABELS: Record<MaterialType, string> = {
  image: '图片',
  video: '视频',
  pdf: 'PDF',
  text: '文案',
}

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  pending: '待处理',
  approved: '通过',
  rejected: '驳回',
  returned: '退回',
}

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  in_review: '审核中',
  completed: '已完成',
}

export const PACKAGE_STATUS_COLORS: Record<PackageStatus, string> = {
  draft: 'default',
  submitted: 'processing',
  in_review: 'processing',
  completed: 'success',
}


export type StrategyScope = "default" | "general"

export interface Strategy {
  id: number
  code: string
  name: string
  scope: StrategyScope
  description: string | null
  is_active: boolean
  priority: number
  effective_from: string | null
  effective_until: string | null
  definition: Record<string, unknown>
  service_config: Record<string, unknown>
  created_at: string
  updated_at: string | null
}

export interface StrategyCreatePayload {
  code?: string
  name: string
  scope?: StrategyScope
  description?: string
  is_active?: boolean
  priority?: number
  effective_from?: string | null
  effective_until?: string | null
  application?: string
  services?: string[]
  definition?: Record<string, unknown>
}

export const APPLICATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '123845083-医药审核策略', label: '123845083-医药审核策略' },
  { value: '123845084-金融审核策略', label: '123845084-金融审核策略' },
  { value: '123845085-通用内容安全策略', label: '123845085-通用内容安全策略' },
  { value: '123845086-跨境电商策略', label: '123845086-跨境电商策略' },
]

export interface StrategyUpdatePayload {
  name?: string
  description?: string
  is_active?: boolean
  priority?: number
  effective_from?: string | null
  effective_until?: string | null
  services?: string[]
  definition?: Record<string, unknown>
  service_config?: Record<string, unknown>
}

export interface ServiceRuleConfigSnapshot {
  service_code: string
  sub_scopes: string[]
  rule_overrides: Record<string, {
    medium_threshold?: number
    high_threshold?: number
    is_enabled?: boolean
    scope_text?: string
  }>
}

export interface StrategyValidateResult {
  ok: boolean
  warnings: string[]
  checked_at: string
}

export const STRATEGY_PRIORITY_LABELS: Record<number, string> = {
  0: "P0 紧急",
  1: "P1 高",
  2: "P2 中",
  3: "P3 低",
}

export function strategyPriorityLabel(p: number): string {
  return STRATEGY_PRIORITY_LABELS[p] ?? `P${p}`
}

export type ServiceScope = "业务场景" | "特殊场景" | "通用场景" | "AIGC场景" | "百炼场景"

export interface ServiceCategory {
  id: number
  code: string
  name: string
  description: string | null
  is_system: boolean
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface ServiceCategoryCreatePayload {
  name: string
  code?: string
  description?: string
  sort_order?: number
}

export interface ServiceCategoryUpdatePayload {
  name?: string
  description?: string
  sort_order?: number
  is_active?: boolean
}

export interface Service {
  id: number
  code: string
  name: string
  scope: ServiceScope
  description: string | null
  is_active: boolean
  is_custom: boolean
  category_id: number | null
  created_at: string
  updated_at: string | null
}

export interface ServiceCreatePayload {
  name: string
  code?: string
  scope?: ServiceScope
  description?: string
  category_id?: number | null
}

export interface ServiceUpdatePayload {
  name?: string
  description?: string
  scope?: ServiceScope
  is_active?: boolean
  category_id?: number | null
}

export type WordSetKind = "黑名单" | "白名单"

export type WordSetGroup =
  | "敏感词"
  | "广告法"
  | "品牌"
  | "行业"
  | "合规"
  | "关键词"
  | "清单"
  | "自定义"

export type WordSetAction = "黑名单" | "白名单" | "需复审" | "标签"

export interface WordSet {
  id: number
  code: string
  name: string
  group: WordSetGroup
  action: WordSetAction
  kind?: WordSetKind | null
  description: string | null
  is_active: boolean
  word_count: number
  ignored_services: string[]
  created_at: string
  updated_at: string | null
}

export type ImageSetGroup =
  | "敏感图"
  | "品牌"
  | "行业"
  | "合规"
  | "清单"
  | "关键词"
  | "自定义"

export type ImageSetAction = "黑名单" | "白名单" | "需复审" | "标签"

export type ImageSetKind = "黑名单" | "白名单"

export interface ImageSet {
  id: number
  code: string
  name: string
  group: ImageSetGroup
  action: ImageSetAction
  kind?: ImageSetKind | null
  description: string | null
  is_active: boolean
  item_count: number
  capacity: number
  ignored_services: string[]
  created_at: string
  updated_at: string | null
}

export interface ImageSetListItem {
  id: number
  code: string
  name: string
  group: ImageSetGroup
  action: ImageSetAction
  kind?: ImageSetKind | null
  item_count: number
  capacity: number
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export const WORD_GROUP_OPTIONS: { value: WordSetGroup; label: string }[] = [
  { value: '敏感词', label: '敏感词' },
  { value: '广告法', label: '广告法' },
  { value: '品牌', label: '品牌' },
  { value: '行业', label: '行业' },
  { value: '合规', label: '合规' },
  { value: '关键词', label: '关键词' },
  { value: '清单', label: '清单' },
  { value: '自定义', label: '自定义' },
]

export const WORD_ACTION_OPTIONS: { value: WordSetAction; label: string }[] = [
  { value: '黑名单', label: '黑名单' },
  { value: '白名单', label: '白名单' },
  { value: '需复审', label: '需复审' },
  { value: '标签', label: '标签' },
]

export const IMAGE_GROUP_OPTIONS: { value: ImageSetGroup; label: string }[] = [
  { value: '敏感图', label: '敏感图' },
  { value: '品牌', label: '品牌' },
  { value: '行业', label: '行业' },
  { value: '合规', label: '合规' },
  { value: '清单', label: '清单' },
  { value: '关键词', label: '关键词' },
  { value: '自定义', label: '自定义' },
]

export const IMAGE_ACTION_OPTIONS: { value: ImageSetAction; label: string }[] = [
  { value: '黑名单', label: '黑名单' },
  { value: '白名单', label: '白名单' },
  { value: '需复审', label: '需复审' },
  { value: '标签', label: '标签' },
]

export interface ImageSetItem {
  id: number
  set_id: number
  original_filename: string
  mime_type: string
  file_size: number
  sha256: string | null
  created_at: string
  download_url: string | null
}

export interface ImageSetUploadResponse {
  uploaded: number
  skipped: number
  item_count: number
  capacity: number
  items: ImageSetItem[]
}

export interface DetectionRule {
  id: number
  service_code: string
  label: string
  label_cn: string
  description: string | null
  medium_threshold: number
  high_threshold: number
  scope_text: string | null
  is_enabled: boolean
  custom_wordset_id: number | null
  created_at: string
  updated_at: string | null
}

export interface WordSetOption {
  id: number
  code: string
  name: string
  kind?: WordSetKind | null
  group?: WordSetGroup
  action?: WordSetAction
}

export type RiskLevel = "高风险" | "中风险" | "低风险" | "无风险"

export interface HumanReviewConfig {
  id: number
  service_code: string
  is_enabled: boolean
  risk_levels: RiskLevel[]
  review_rule_id: number | null
  notify_plan_id: number | null
  created_at: string
  updated_at: string | null
}
