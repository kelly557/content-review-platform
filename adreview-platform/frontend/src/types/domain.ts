import type { UserRole } from './auth'
export type { User, UserRole } from './auth'

export type MaterialType = 'image' | 'video' | 'pdf' | 'text'
export type MaterialStatus = 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn'
export type ReviewDecision = 'pending' | 'approved' | 'rejected' | 'returned' | 'canceled'
export type ReviewType = 'machine' | 'human'
export type MachineStatus = 'pending' | 'running' | 'completed' | 'failed'
export type WorkflowMode = 'machine_only' | 'machine_then_human'
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

export interface ReviewAssignmentTagSnapshot {
  id: string
  code: string
  name: string
  domain: string
  category: string
  status?: string
}

export interface ReviewAssignmentTag {
  id: number
  tag_id: string
  tag_snapshot: ReviewAssignmentTagSnapshot
  created_at: string
}

export interface ReviewAssignment {
  id: number
  task_id: number
  assignee_id: number
  decision: ReviewDecision
  note?: string | null
  decided_at?: string | null
  tags?: ReviewAssignmentTag[]
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
  material_type?: MaterialType | null
  material_status?: MaterialStatus | null
  // v10
  workflow_mode?: WorkflowMode
  canceled_at?: string | null
  canceled_by?: number | null
  cancel_reason?: string | null
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

export interface WorkflowStage {
  key: string
  name: string
  type: 'human' | 'machine'
  role: string
  mode: 'single' | 'joint'
}

export interface WorkflowTemplate {
  id: number
  code: string
  name: string
  description?: string | null
  definition: { stages?: WorkflowStage[]; review_process?: string }
  is_active: boolean
}

export interface WorkflowStagePayload {
  name: string
  role: string
  mode: 'single' | 'joint'
}

export interface WorkflowTemplateCreate {
  code: string
  name: string
  description?: string
  is_active?: boolean
  stages: WorkflowStagePayload[]
}

export interface WorkflowTemplateUpdate {
  name?: string
  description?: string
  is_active?: boolean
  stages?: WorkflowStagePayload[]
}

export interface OverviewStats {
  total_materials: number
  in_review: number
  approved: number
  rejected: number
  submitted: number
  avg_review_hours: number | null
  reject_rate: number
  review_rate: number
  approve_rate: number
}

// ---------------------------------------------------------------------------
// Analytics (data-analysis) page
// ---------------------------------------------------------------------------

export type TrendMetric = 'reject_rate' | 'review_rate' | 'approve_rate' | 'submitted'

export interface TrendPoint {
  bucket: string
  value: number
  sample_count: number
}

export interface TrendResponse {
  metric: TrendMetric
  granularity: string
  window_start: string
  window_end: string
  points: TrendPoint[]
  delta_pct: number | null
}

export interface AnomalyCurrent {
  bucket: string
  reject_rate: number
  review_rate: number
  approve_rate: number
  submitted: number
  rejected: number
  high_risk_accounts: number
}

export interface AnomalyMetricPoint {
  bucket: string
  reject_rate: number
  review_rate: number
  approve_rate: number
  submitted: number
}

export interface AnomalyAlertSummary {
  id: number
  rule_code: string
  severity: string
  metric: string
  window_start: string
  window_end: string
  observed_value: number
  threshold: number
  status: string
  created_at: string
  detail: Record<string, unknown>
}

export interface AnomalyResponse {
  window: string
  current: AnomalyCurrent
  series: AnomalyMetricPoint[]
  alerts: AnomalyAlertSummary[]
}

export interface QualityVerdictCount {
  misjudge: number
  miss: number
  agree: number
  total: number
}

export interface QualityDetailRow {
  task_id: number
  material_id: number
  strategy_code: string | null
  machine_decision: string | null
  human_decision: string | null
  verdict: 'misjudge' | 'miss' | 'agree'
  feedback: string | null
  completed_at: string | null
}

export interface ReasonCount {
  label: string
  count: number
}

export interface QualityResponse {
  window_start: string
  window_end: string
  misjudge_rate: number
  miss_rate: number
  agree_rate: number
  avg_review_hours: number | null
  top_rejection_reasons: ReasonCount[]
  top_false_positive_tags: ReasonCount[]
  verdicts: QualityVerdictCount
  detail: QualityDetailRow[]
  detail_total: number
}

export interface AlertEventOut {
  id: number
  rule_code: string
  severity: string
  metric: string
  window_start: string
  window_end: string
  observed_value: number
  threshold: number
  dimension: Record<string, unknown>
  detail: Record<string, unknown>
  status: 'open' | 'acknowledged'
  ack_by: number | null
  ack_at: string | null
  ack_note: string | null
  notified: boolean
  created_at: string
}

export interface AlertPage {
  items: AlertEventOut[]
  total: number
  page: number
  size: number
}

/**
 * Risk dashboard types (overview page).
 * The 5-level enum matches the backend ``RiskLevel`` (高/中/低/敏感/无).
 * NOTE: ``RiskLevel`` is declared later in this file as a 5-value union
 * (HumanReviewConfig also uses it). We add the dashboard helpers above
 * for grouping, but reference the existing ``RiskLevel`` directly to keep
 * a single source of truth.
 */
export const RISK_LEVELS = ['高风险', '中风险', '低风险', '敏感', '无风险'] as const

export interface RiskTimeseriesPoint {
  date: string
  total: number
  high: number
  medium: number
  low: number
  sensitive: number
  none: number
}

export interface RiskDistributionBucket {
  level: RiskLevel
  count: number
}

export interface TopRiskLabelItem {
  label: string
  count: number
  risk_level: RiskLevel
  last_hit_at: string
}

export const ROLE_LABELS: Record<UserRole, string> = {
  submitter: '提交者',
  reviewer: '审核员',
  mlr: 'MLR 专家',
  admin: '管理员',
  superadmin: '超级管理员',
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
  canceled: '已取消',
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

export interface TaskStatusConfig {
  label: string
  color: string
  icon: string
}

export const TASK_STATUS_CONFIG: Record<string, TaskStatusConfig> = {
  pending: { label: '待处理', color: 'blue', icon: 'ClockCircleOutlined' },
  machine_running: { label: '机审中', color: 'cyan', icon: 'RobotOutlined' },
  machine_completed: { label: '机审完成', color: 'green', icon: 'CheckCircleOutlined' },
  machine_failed: { label: '机审失败', color: 'red', icon: 'ExclamationCircleOutlined' },
  in_review: { label: '人审中', color: 'orange', icon: 'UserOutlined' },
  approved: { label: '已通过', color: 'success', icon: 'CheckCircleOutlined' },
  rejected: { label: '已驳回', color: 'error', icon: 'CloseCircleOutlined' },
  returned: { label: '已退回', color: 'warning', icon: 'RollbackOutlined' },
  canceled: { label: '已取消', color: 'default', icon: 'StopOutlined' },
}

export function getTaskStatus(task: ReviewTask): string {
  if (task.final_decision !== 'pending') {
    return task.final_decision
  }
  if (task.review_type === 'machine') {
    if (task.machine_status === 'running') return 'machine_running'
    if (task.machine_status === 'completed') return 'machine_completed'
    if (task.machine_status === 'failed') return 'machine_failed'
    return 'pending'
  }
  return 'in_review'
}

export const WORKFLOW_MODE_LABELS: Record<WorkflowMode, string> = {
  machine_only: '纯机审',
  machine_then_human: '机审+人审',
}


export type StrategyScope = "default" | "general"

export type MediaTypeKey = "image" | "text" | "audio" | "doc" | "video"

export interface StrategyItemRef {
  media_type: MediaTypeKey
  item_id: number
  is_enabled: boolean
}

export interface StrategyPointRef {
  media_type: MediaTypeKey
  item_id: number
  point_id: number
  is_enabled: boolean
  /** 策略级 override（中/高风险分），范围 50~100 */
  medium_threshold?: number
  high_threshold?: number
  /** 策略级 override 关联自定义库 ID 列表 */
  linked_library_ids?: number[]
}

export interface StrategyEnabledPointsMeta {
  total: number
  enabled: number
  disabled: number
  has_overrides: boolean
}

export interface Strategy {
  id: number
  code: string
  name: string
  scope: StrategyScope
  description: string | null
  is_active: boolean
  effective_from: string | null
  effective_until: string | null
  definition: Record<string, unknown>
  service_config: Record<string, unknown>
  enabled_items: StrategyItemRef[]
  enabled_points?: StrategyPointRef[]
  created_at: string
  updated_at: string | null
}

export interface StrategyCreatePayload {
  code?: string
  name: string
  scope?: StrategyScope
  description?: string
  is_active?: boolean
  effective_from?: string | null
  effective_until?: string | null
  application?: string
  services?: string[]
  enabled_items?: StrategyItemRef[]
  enabled_points?: StrategyPointRef[]
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
  effective_from?: string | null
  effective_until?: string | null
  services?: string[]
  enabled_items?: StrategyItemRef[]
  enabled_points?: StrategyPointRef[]
  definition?: Record<string, unknown>
  service_config?: Record<string, unknown>
}

export interface StrategyValidateResult {
  ok: boolean
  warnings: string[]
  checked_at: string
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

// ─── Libraries v3 (replaces word_sets + image_sets + hardcoded groups) ───

export type LibraryType = 'word' | 'image' | 'reply'

/** 词库/图片库的匹配语义。代答库不暴露此字段（其条目本身就是命中即触发的规则）。 */
export type LibraryKind = '黑名单' | '白名单'

export const LIBRARY_KIND_OPTIONS: { value: LibraryKind; label: string; color: string }[] = [
  { value: '黑名单', label: '黑名单', color: 'red' },
  { value: '白名单', label: '白名单', color: 'green' },
]

export type LibraryEffectiveStatus = '已停用' | '未生效' | '生效中' | '已过期' | '永久'

export interface Library {
  id: number
  code: string
  name: string
  library_type: LibraryType
  /** 仅 word / image 库返回；reply 库为 null */
  kind: LibraryKind | null
  description: string | null
  is_active: boolean
  /** 通用平台库标记:true 表示仅超级管理员可见可改可删 */
  is_platform: boolean
  is_deleted: boolean
  deleted_at: string | null
  item_count: number
  ignored_services: string[]
  /** 有效时间区间（UTC，ISO8601）。两者皆空表示永久。 */
  effective_from: string | null
  effective_until: string | null
  /** 派生：当前是否生效（停用 / 过期 / 未到 都视为不生效） */
  is_effective: boolean
  created_at: string
  updated_at: string | null
}

export interface LibraryListItem {
  id: number
  code: string
  name: string
  library_type: LibraryType
  kind: LibraryKind | null
  description: string | null
  is_active: boolean
  /** 通用平台库标记:true 表示仅超级管理员可见可改可删 */
  is_platform: boolean
  is_deleted: boolean
  item_count: number
  effective_from: string | null
  effective_until: string | null
  is_effective: boolean
  created_at: string
  updated_at: string | null
}

export interface LibraryCreate {
  code?: string
  name: string
  library_type: LibraryType
  /** word / image 必填；reply 不传 */
  kind?: LibraryKind | null
  description?: string
  words?: string[]
  /** 有效时间（UTC ISO8601）。不传或为 null 表示永久。 */
  effective_from?: string | null
  effective_until?: string | null
  /** 「通用平台库」标记：仅超级管理员可设为 true；服务端会兜底守卫。 */
  is_platform?: boolean
}

export interface LibraryUpdate {
  name?: string
  kind?: LibraryKind
  description?: string
  is_active?: boolean
  ignored_services?: string[]
  effective_from?: string | null
  effective_until?: string | null
  /** 「通用平台库」标记：仅超级管理员可设置。仅当 key 显式传进 body 时才会落库。 */
  is_platform?: boolean | null
}

export interface LibraryDeletePayload {
  transfer_to_library_id?: number
  force?: boolean
}

export interface AuditPointRef {
  audit_point_id: number
  service_code: string
  label: string
}

export interface LibraryDeleteResponse {
  ok: boolean
  transferred_to: number | null
  forced: boolean
  affected_audit_points: number
  references: AuditPointRef[]
}

export interface LibraryItem {
  id: number
  library_id: number
  word: string | null
  original_filename: string | null
  mime_type: string | null
  file_size: number | null
  sha256: string | null
  created_at: string
  download_url: string | null
}

export interface LibraryImageUploadResponse {
  uploaded: number
  skipped: number
  item_count: number
  items: LibraryItem[]
}

export interface LibraryItemBatchDeleteResponse {
  deleted: number
  skipped: number
}

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
  audit_point_id: number | null
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

export type RiskLevel = '高风险' | '中风险' | '低风险' | '敏感' | '无风险'

export interface HumanReviewConfig {
  id: number
  service_code: string
  is_enabled: boolean
  risk_levels: RiskLevel[]
  review_rule_id: number | null
  created_at: string
  updated_at: string | null
}

// ─── Tag management (flat multi-dimensional, metadata-only) ───────────────

export type TagDomain =
  | 'politics'
  | 'porn'
  | 'violence'
  | 'ads_law'
  | 'medical'
  | 'finance'
  | 'minor'
  | 'privacy'
  | 'ip'
  | 'gambling'
  | 'fraud'
  | 'custom'

export type TagCategory =
  | 'figure'
  | 'event'
  | 'organization'
  | 'symbol'
  | 'claim'
  | 'slogan'
  | 'scene'
  | 'product'
  | 'price'
  | 'absolute_term'
  | 'credential'
  | 'custom'

export type TagStatus = 'draft' | 'active' | 'deprecated'

export interface Tag {
  id: string
  code: string
  name: string
  name_en?: string | null
  description?: string | null
  domain: TagDomain
  category: TagCategory
  jurisdictions: string[]
  industries: string[]
  channels: string[]
  knowledge_refs: string[]
  evidence_refs: string[]
  status: TagStatus
  version: number
  created_at: string
  updated_at?: string | null
}

export interface TagSummary {
  id: string
  code: string
  name: string
  name_en?: string | null
  domain: TagDomain
  category: TagCategory
  jurisdictions: string[]
  industries: string[]
  channels: string[]
  status: TagStatus
  updated_at?: string | null
}

export interface TagCreate {
  code?: string
  name: string
  name_en?: string
  description?: string
  domain: TagDomain
  category: TagCategory
  jurisdictions?: string[]
  industries?: string[]
  channels?: string[]
  knowledge_refs?: string[]
  evidence_refs?: string[]
  status?: TagStatus
}

export interface TagUpdate {
  name?: string
  name_en?: string | null
  description?: string | null
  domain?: TagDomain
  category?: TagCategory
  jurisdictions?: string[]
  industries?: string[]
  channels?: string[]
  knowledge_refs?: string[]
  evidence_refs?: string[]
  status?: TagStatus
}

export const TAG_DOMAIN_OPTIONS: { value: TagDomain; label: string; cn: string }[] = [
  { value: 'politics', label: 'politics', cn: '涉政' },
  { value: 'porn', label: 'porn', cn: '涉黄' },
  { value: 'violence', label: 'violence', cn: '涉暴' },
  { value: 'ads_law', label: 'ads_law', cn: '广告法' },
  { value: 'medical', label: 'medical', cn: '医药' },
  { value: 'finance', label: 'finance', cn: '金融' },
  { value: 'minor', label: 'minor', cn: '未成年人' },
  { value: 'privacy', label: 'privacy', cn: '隐私' },
  { value: 'ip', label: 'ip', cn: '知识产权' },
  { value: 'gambling', label: 'gambling', cn: '赌博' },
  { value: 'fraud', label: 'fraud', cn: '欺诈' },
  { value: 'custom', label: 'custom', cn: '自定义' },
]

export const TAG_CATEGORY_OPTIONS: { value: TagCategory; label: string; cn: string }[] = [
  { value: 'figure', label: 'figure', cn: '人物' },
  { value: 'event', label: 'event', cn: '事件' },
  { value: 'organization', label: 'organization', cn: '组织' },
  { value: 'symbol', label: 'symbol', cn: '符号/标识' },
  { value: 'claim', label: 'claim', cn: '宣称/话术' },
  { value: 'slogan', label: 'slogan', cn: '口号' },
  { value: 'scene', label: 'scene', cn: '场景/画面' },
  { value: 'product', label: 'product', cn: '产品/SKU' },
  { value: 'price', label: 'price', cn: '价格表述' },
  { value: 'absolute_term', label: 'absolute_term', cn: '绝对化用语' },
  { value: 'credential', label: 'credential', cn: '资质/批文' },
  { value: 'custom', label: 'custom', cn: '自定义' },
]

export const TAG_STATUS_OPTIONS: { value: TagStatus; label: string; color: string }[] = [
  { value: 'active', label: '已启用', color: 'green' },
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'deprecated', label: '已停用', color: 'default' },
]

export const TAG_JURISDICTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'cn', label: '中国大陆' },
  { value: 'us', label: '美国' },
  { value: 'eu', label: '欧盟' },
  { value: 'global', label: '全球' },
]

export interface AuditItem {
  id: number
  package_code: string
  code: string
  name_cn: string
  aliases: string[]
  description: string | null
  sort_order: number
  is_enabled: boolean
  is_builtin: boolean
  point_count: number
  created_at: string
  updated_at: string | null
}

export interface AuditItemCreate {
  name_cn: string
  aliases?: string[]
  description?: string
  sort_order?: number
  is_enabled?: boolean
}

export interface AuditItemUpdate {
  name_cn?: string
  aliases?: string[]
  description?: string
  sort_order?: number
  is_enabled?: boolean
}

export type AuditPointRisk = '低风险' | '中风险' | '高风险'

export interface LinkedLibrary {
  library_id: number
  library_type: LibraryType
  code: string
  name: string
  group_id: number | null
  group_name: string | null
  sort_order: number
}

export interface AuditPoint {
  id: number
  package_code: string
  item_id: number
  code: string
  label: string
  label_cn: string
  description: string | null
  medium_threshold: number
  high_threshold: number
  scope_text: string | null
  risk_level: AuditPointRisk
  is_enabled: boolean
  is_builtin: boolean
  custom_wordset_id: number | null
  custom_library_id?: number | null
  custom_reply_library_id?: number | null
  linked_libraries: LinkedLibrary[]
  sort_order: number
  created_at: string
  updated_at: string | null
}

export interface AuditPointCreate {
  item_id: number
  label_cn: string
  description?: string
  medium_threshold?: number
  high_threshold?: number
  scope_text?: string
  risk_level?: AuditPointRisk
  is_enabled?: boolean
  custom_wordset_id?: number
  sort_order?: number
  linked_library_ids?: number[]
}

export interface AuditPointUpdate {
  label_cn?: string
  description?: string
  medium_threshold?: number
  high_threshold?: number
  scope_text?: string
  risk_level?: AuditPointRisk
  is_enabled?: boolean
  custom_wordset_id?: number
  custom_library_id?: number | null
  custom_reply_library_id?: number | null
  sort_order?: number
  /** PATCH 语义: undefined=不动；[]=清空；[非空]=全量替换 */
  linked_library_ids?: number[]
}

export interface AuditPointBatchItem {
  index: number
  label_cn: string
  status: 'ok' | 'error'
  point?: AuditPoint
  error?: string
}

export interface AuditPointBatchResult {
  succeeded: number
  failed: number
  items: AuditPointBatchItem[]
}

export type LibraryKindOfType = 'word' | 'image' | 'reply'

export interface LibraryBatchItemPayload {
  code: string
  name: string
  library_type: LibraryType
  kind?: LibraryKind | null
  description?: string | null
  is_active?: boolean
  words?: string[]
  /** 「通用平台库」标记：仅超级管理员可设为 true。 */
  is_platform?: boolean
}

export interface LibraryBatchCreateRequest {
  libraries: LibraryBatchItemPayload[]
}

export interface LibraryBatchCreateError {
  index: number
  code: string
  error: string
}

export interface LibraryBatchCreateResult {
  succeeded: number
  failed: number
  libraries: Library[]
  errors: LibraryBatchCreateError[]
}

export interface ItemSuggestion {
  item_id: number
  item_code: string
  item_name_cn: string
  score: number
  matched_aliases: string[]
  matched_terms: string[]
}

export interface SuggestResponse {
  matches: ItemSuggestion[]
  mock: boolean
  engine: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Stubs for in-progress WIP (HumanReviewSettings / Desensitization / Reply Library) — to be consolidated.
// ──────────────────────────────────────────────────────────────────────────────

export type StrategyRiskLevel = '低风险' | '中风险' | '高风险' | '无风险' | '敏感'

export type AutoAction = 'approved' | 'rejected' | 'desensitize' | 'review'

/** key = "<risk>|<sensitive>"，sensitive = "—" 表示该 risk 无 sensitive 维度 */
export type AutoActionOverrides = Record<string, AutoAction>

function isAutoActionOverrides(
  v: unknown,
): v is AutoActionOverrides {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(
    (x) => x === 'approved' || x === 'rejected' || x === 'desensitize' || x === 'review',
  )
}

export interface StrategyHumanReview {
  is_enabled: boolean
  risk_levels: StrategyRiskLevel[]
  sensitive_levels: SensitiveLevel[]
  review_rule_id: number | null
  /** 用户对每个 cell 动作的覆盖。嵌进 strategy.definition.human_review dict。 */
  auto_action_overrides?: AutoActionOverrides
  /**
   * 抽审比例（0~100，百分比）。在符合升级条件的素材中按此比例抽样进入人审。
   * - 100 = 全部升级（默认，向后兼容）
   * - 0   = 不升级，全部按默认矩阵处理
   * 未抽中的素材按默认矩阵（高/中/敏感 S2/S3 拒绝；低风险通过）。
   */
  sample_ratio?: number
}

export const EMPTY_HUMAN_REVIEW: StrategyHumanReview = {
  is_enabled: false,
  risk_levels: [],
  sensitive_levels: [],
  review_rule_id: null,
  auto_action_overrides: {},
  sample_ratio: 100,
}

export const STRATEGY_RISK_LEVEL_OPTIONS: ReadonlyArray<{
  value: StrategyRiskLevel
  label: string
  color: string
}> = [
  { value: '高风险', label: '高风险', color: 'red' },
  { value: '中风险', label: '中风险', color: 'orange' },
  { value: '低风险', label: '低风险', color: 'blue' },
  { value: '无风险', label: '无风险', color: 'default' },
  { value: '敏感',   label: '敏感',   color: 'purple' },
]

// ─── v6 敏感等级 (SensitiveLevel) ─────────────────────────────────────────────
// 与后端 backend/app/models/sensitive_level.py:SensitiveLevel 保持一致。
// 数字越大敏感程度越高；S0 = 未检出敏感内容。
export type SensitiveLevel = 'S0' | 'S1' | 'S2' | 'S3'

export const SENSITIVE_LEVEL_OPTIONS: ReadonlyArray<{
  value: SensitiveLevel
  label: string
  rank: number
  color: string
}> = [
  { value: 'S0', label: 'S0 未检出', rank: 0, color: 'default' },
  { value: 'S1', label: 'S1 轻度敏感', rank: 1, color: 'blue' },
  { value: 'S2', label: 'S2 中度敏感', rank: 2, color: 'orange' },
  { value: 'S3', label: 'S3 重度敏感', rank: 3, color: 'red' },
]

// 素材级动作（与后端 RISK_LEVELS_AUTO_* 保持语义一致）
export type SuggestedAction =
  | 'approved'
  | 'rejected'
  | 'desensitize'
  | 'review'

// 关闭人审时的处置预览（双轴：risk × sensitive）
// 单一来源：HumanReviewSettings 渲染表 + 后端 _suggest_action_for 需保持一致
export type DispositionIcon = 'stop' | 'scissor' | 'check'

export interface DispositionRow {
  risk: StrategyRiskLevel | '敏感' | '无风险'
  sensitive: SensitiveLevel | '—'
  action: SuggestedAction
  statusLabel: string
  statusColor: 'volcano' | 'red' | 'orange' | 'gold' | 'green' | 'blue' | 'default'
  iconName?: DispositionIcon
  note?: string
}

export const DEFAULT_DISPOSITION_PREVIEW: ReadonlyArray<DispositionRow> = [
  {
    risk: '高风险',
    sensitive: '—',
    action: 'rejected',
    statusLabel: '拒绝',
    statusColor: 'volcano',
    iconName: 'stop',
    note: '命中医疗/政治等',
  },
  {
    risk: '中风险',
    sensitive: '—',
    action: 'rejected',
    statusLabel: '拒绝',
    statusColor: 'volcano',
    iconName: 'stop',
    note: '不放行（人审开→升级人审）',
  },
  {
    risk: '敏感',
    sensitive: 'S3',
    action: 'rejected',
    statusLabel: '拒绝',
    statusColor: 'volcano',
    iconName: 'stop',
    note: '重度敏感（人审开+召回→升级人审）',
  },
  {
    risk: '敏感',
    sensitive: 'S2',
    action: 'rejected',
    statusLabel: '拒绝',
    statusColor: 'volcano',
    iconName: 'stop',
    note: '中度敏感，不放行（人审开+召回→升级人审）',
  },
  {
    risk: '敏感',
    sensitive: 'S1',
    action: 'desensitize',
    statusLabel: '脱敏放行',
    statusColor: 'gold',
    iconName: 'scissor',
    note: '轻度敏感，自动脱敏后放行',
  },
  {
    risk: '敏感',
    sensitive: 'S0',
    action: 'approved',
    statusLabel: '通过',
    statusColor: 'green',
    iconName: 'check',
    note: '没检出敏感内容',
  },
  {
    risk: '低风险',
    sensitive: '—',
    action: 'approved',
    statusLabel: '通过',
    statusColor: 'green',
    iconName: 'check',
  },
  {
    risk: '无风险',
    sensitive: '—',
    action: 'approved',
    statusLabel: '通过',
    statusColor: 'green',
    iconName: 'check',
  },
]

// 开启人审时的处置预览（与 backend _suggest_action_for v10 严格对齐）
// 策略级优先：人审开 → review；人审关 → approved/rejected。recall_mode 不再参与。
// 高/中风险：人审开 → review
// 敏感 S2/S3：人审开 → review
// 敏感 S1：永远 desensitize（不升级人审）
// 敏感 S0：approved
// 低风险：人审开 → review
// 无风险：approved
export const HUMAN_ON_DISPOSITION_PREVIEW: ReadonlyArray<DispositionRow> = [
  {
    risk: '高风险',
    sensitive: '—',
    action: 'review',
    statusLabel: '升级人审',
    statusColor: 'gold',
    iconName: 'check',
    note: '命中高风险',
  },
  {
    risk: '中风险',
    sensitive: '—',
    action: 'review',
    statusLabel: '升级人审',
    statusColor: 'gold',
    iconName: 'check',
    note: '命中中风险',
  },
  {
    risk: '敏感',
    sensitive: 'S3',
    action: 'review',
    statusLabel: '升级人审',
    statusColor: 'gold',
    iconName: 'check',
    note: '命中敏感 S3',
  },
  {
    risk: '敏感',
    sensitive: 'S2',
    action: 'review',
    statusLabel: '升级人审',
    statusColor: 'gold',
    iconName: 'check',
    note: '命中敏感 S2',
  },
  {
    risk: '敏感',
    sensitive: 'S1',
    action: 'desensitize',
    statusLabel: '脱敏放行',
    statusColor: 'gold',
    iconName: 'scissor',
    note: '轻度敏感自动脱敏，不升级人审',
  },
  {
    risk: '敏感',
    sensitive: 'S0',
    action: 'approved',
    statusLabel: '通过',
    statusColor: 'green',
    iconName: 'check',
    note: '未检出敏感内容',
  },
  {
    risk: '低风险',
    sensitive: '—',
    action: 'review',
    statusLabel: '升级人审',
    statusColor: 'gold',
    iconName: 'check',
    note: '命中低风险',
  },
  {
    risk: '无风险',
    sensitive: '—',
    action: 'approved',
    statusLabel: '通过',
    statusColor: 'green',
    iconName: 'check',
  },
]

export function extractHumanReview(
  definition: Record<string, unknown> | null | undefined,
): StrategyHumanReview {
  const raw = (definition?.human_review ?? {}) as Partial<StrategyHumanReview>
  const sampleRatio =
    typeof raw.sample_ratio === 'number' &&
    raw.sample_ratio >= 0 &&
    raw.sample_ratio <= 100
      ? raw.sample_ratio
      : 100
  return {
    is_enabled: Boolean(raw.is_enabled),
    risk_levels: Array.isArray(raw.risk_levels)
      ? (raw.risk_levels as StrategyRiskLevel[])
      : [],
    sensitive_levels: Array.isArray(raw.sensitive_levels)
      ? (raw.sensitive_levels as SensitiveLevel[])
      : [],
    review_rule_id:
      typeof raw.review_rule_id === 'number' ? raw.review_rule_id : null,
    auto_action_overrides: isAutoActionOverrides(raw.auto_action_overrides)
      ? raw.auto_action_overrides
      : {},
    sample_ratio: sampleRatio,
  }
}

// ─── Voice rule mode (语音审核：复用文本规则 / 独立规则) ─────────────────────────
// 存入 strategy.definition.voice_rule_mode；默认 'reuse_text'。

export type VoiceRuleMode = 'reuse_text' | 'independent'

export function isVoiceRuleMode(v: unknown): v is VoiceRuleMode {
  return v === 'reuse_text' || v === 'independent'
}

export function extractVoiceRuleMode(
  definition: Record<string, unknown> | null | undefined,
): VoiceRuleMode {
  const v = definition?.voice_rule_mode
  return isVoiceRuleMode(v) ? v : 'reuse_text'
}

// ─── Audio features (语音专有能力：声纹 / 音频质量，存 JSONB) ─────────────────────
// 存入 strategy.definition.audio_features。无论复用/独立模式都生效。

export interface AudioFeatures {
  voiceprint: {
    /** 娇喘检测 */
    moaning: boolean
  }
  quality: {
    /** 无语音内容 */
    no_speech: boolean
  }
}

export const DEFAULT_AUDIO_FEATURES: AudioFeatures = {
  voiceprint: { moaning: true },
  quality: { no_speech: true },
}

export function extractAudioFeatures(
  definition: Record<string, unknown> | null | undefined,
): AudioFeatures {
  const raw = (definition?.audio_features ?? {}) as {
    voiceprint?: { moaning?: unknown }
    quality?: { no_speech?: unknown }
  }
  return {
    voiceprint: {
      moaning: typeof raw.voiceprint?.moaning === 'boolean'
        ? raw.voiceprint.moaning
        : DEFAULT_AUDIO_FEATURES.voiceprint.moaning,
    },
    quality: {
      no_speech: typeof raw.quality?.no_speech === 'boolean'
        ? raw.quality.no_speech
        : DEFAULT_AUDIO_FEATURES.quality.no_speech,
    },
  }
}

// ─── Document/Video compose rule modes ─────────────────────────────────────
// 文档审核由「文本审核 + 图像审核」组合而成；视频审核由「图像审核 + 语音审核」组合而成。
// 每组上游类型一个 mode：'reuse_<source>' 表示复用上游类型规则；'independent' 表示独立设置。
// 文档：doc_text_mode（复用文本审核规则 / independent），doc_image_mode（复用图像审核规则 / independent）
// 视频：video_frame_mode（复用图像审核规则 / independent），video_audio_mode（复用短音频同步审核规则 / independent）

export type DocTextMode = 'reuse_text' | 'independent'
export type DocImageMode = 'reuse_image' | 'independent'
export type VideoFrameMode = 'reuse_image' | 'independent'
export type VideoAudioMode = 'reuse_audio' | 'independent'

export interface DocComposeModes {
  text_mode: DocTextMode
  image_mode: DocImageMode
}

export interface VideoComposeModes {
  frame_mode: VideoFrameMode
  audio_mode: VideoAudioMode
}

export const DEFAULT_DOC_COMPOSE_MODES: DocComposeModes = {
  text_mode: 'reuse_text',
  image_mode: 'reuse_image',
}

export const DEFAULT_VIDEO_COMPOSE_MODES: VideoComposeModes = {
  frame_mode: 'reuse_image',
  audio_mode: 'reuse_audio',
}

export const DEFAULT_VIDEO_FRAME_INTERVAL_SEC = 5
export const MIN_VIDEO_FRAME_INTERVAL_SEC = 1
export const MAX_VIDEO_FRAME_INTERVAL_SEC = 1000

function isDocTextMode(v: unknown): v is DocTextMode {
  return v === 'reuse_text' || v === 'independent'
}
function isDocImageMode(v: unknown): v is DocImageMode {
  return v === 'reuse_image' || v === 'independent'
}
function isVideoFrameMode(v: unknown): v is VideoFrameMode {
  return v === 'reuse_image' || v === 'independent'
}
function isVideoAudioMode(v: unknown): v is VideoAudioMode {
  return v === 'reuse_audio' || v === 'independent'
}

export function extractDocComposeModes(
  definition: Record<string, unknown> | null | undefined,
): DocComposeModes {
  const text_mode = isDocTextMode(definition?.doc_text_mode)
    ? (definition!.doc_text_mode as DocTextMode)
    : DEFAULT_DOC_COMPOSE_MODES.text_mode
  const image_mode = isDocImageMode(definition?.doc_image_mode)
    ? (definition!.doc_image_mode as DocImageMode)
    : DEFAULT_DOC_COMPOSE_MODES.image_mode
  return { text_mode, image_mode }
}

export function extractVideoComposeModes(
  definition: Record<string, unknown> | null | undefined,
): VideoComposeModes {
  const frame_mode = isVideoFrameMode(definition?.video_frame_mode)
    ? (definition!.video_frame_mode as VideoFrameMode)
    : DEFAULT_VIDEO_COMPOSE_MODES.frame_mode
  const audio_mode = isVideoAudioMode(definition?.video_audio_mode)
    ? (definition!.video_audio_mode as VideoAudioMode)
    : DEFAULT_VIDEO_COMPOSE_MODES.audio_mode
  return { frame_mode, audio_mode }
}

export function extractVideoFrameInterval(
  definition: Record<string, unknown> | null | undefined,
): number {
  const v = definition?.video_frame_interval_sec
  if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_VIDEO_FRAME_INTERVAL_SEC && v <= MAX_VIDEO_FRAME_INTERVAL_SEC) {
    return Math.floor(v)
  }
  return DEFAULT_VIDEO_FRAME_INTERVAL_SEC
}

export interface DesensitizeSpan {
  start: number
  end: number
  category: string
}

export interface LibraryItem {
  id: number
  library_id: number
  word: string | null
  trigger?: string | null
  reply?: string | null
  pairs?: Array<{ trigger: string; reply: string }>
  is_deleted: boolean
}

export interface ReplyLibraryItem {
  id: number
  library_id: number
  trigger: string
  reply: string
  is_deleted: boolean
}

export interface ReplyLibraryItemCreate {
  library_id: number
  trigger: string
  reply: string
}

// ─── 数据查询 (Inspection Query) ────────────────────────────────────────────────

export type DetectionModality = 'image' | 'video' | 'pdf' | 'text'

export const DETECTION_MODALITIES: { value: DetectionModality; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'pdf', label: '文件' },
]

export type MachineDecision = 'block' | 'review' | 'pass'

export const MACHINE_DECISION_OPTIONS: { value: MachineDecision; label: string; color: string }[] = [
  { value: 'block', label: '阻断', color: 'red' },
  { value: 'review', label: '复核', color: 'orange' },
  { value: 'pass', label: '通过', color: 'green' },
]

export const FEEDBACK_OPTIONS: { value: ReviewDecision; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'approved', label: '通过' },
  { value: 'rejected', label: '驳回' },
  { value: 'returned', label: '退回' },
]

export interface MachineHit {
  service_code?: string | null
  service_name?: string | null
  label?: string | null
  label_cn?: string | null
  score?: number | null
  quote?: string | null
}

export interface MachineReviewRecord {
  id: number
  title?: string | null
  review_type?: string | null
  final_decision?: string | null
  material_id?: number | null
  material_version_id?: number | null
  material_type?: DetectionModality | string | null
  strategy_code?: string | null
  strategy_name?: string | null
  risk_level?: string | null
  machine_decision?: MachineDecision | null
  bailian_request_id?: string | null
  ip?: string | null
  account_id?: string | null
  submitter_id?: number | null
  submitter_name?: string | null
  assignee_id?: number | null
  assignee_name?: string | null
  hits: MachineHit[]
  violation_tags: Array<Record<string, unknown>>
  summary?: string | null
  requested_at?: string | null
  finished_at?: string | null
}

export interface AdvancedCondition {
  op: 'contains' | 'not_contains'
  value: string
}

export interface QueryFilters {
  start?: string
  end?: string
  material_types?: DetectionModality[]
  strategy_code?: string
  machine_decision?: MachineDecision
  request_ids?: number[]
  task_ids?: number[]
  text_contains?: string
  labels?: string[]
  feedback?: ReviewDecision
  conditions?: AdvancedCondition[]
  page?: number
  size?: number
}

export type QueryColumnKey =
  | 'strategy_name'
  | 'machine_decision'
  | 'feedback'
  | 'request_id'
  | 'task_id'
  | 'labels'
  | 'risk_level'
  | 'requested_at'
  | 'ip'
  | 'account_id'

export interface QueryColumnDef {
  key: QueryColumnKey
  title: string
  defaultVisible: boolean
}

export const QUERY_COLUMNS: QueryColumnDef[] = [
  { key: 'strategy_name', title: '策略名称', defaultVisible: true },
  { key: 'machine_decision', title: '检测结果', defaultVisible: true },
  { key: 'feedback', title: '反馈结果', defaultVisible: true },
  { key: 'request_id', title: 'Request ID', defaultVisible: false },
  { key: 'task_id', title: 'Task ID', defaultVisible: false },
  { key: 'labels', title: '命中标签及置信度', defaultVisible: false },
  { key: 'risk_level', title: '风险等级', defaultVisible: false },
  { key: 'requested_at', title: '请求时间', defaultVisible: false },
  { key: 'ip', title: 'IP', defaultVisible: false },
  { key: 'account_id', title: 'AccountId', defaultVisible: false },
]

export const DEFAULT_VISIBLE_COLUMNS: QueryColumnKey[] = QUERY_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.key)

// ─── 复审队列 (/query/review) — 卡片视图，只读 ────────────────────────────────

export interface ReviewRecord {
  id: number
  title?: string | null
  review_type?: string | null
  material_id: number
  material_version_id: number
  material_type?: string | null
  preview_url?: string | null
  mime_type?: string | null
  strategy_code?: string | null
  strategy_name?: string | null
  risk_level?: string | null
  machine_decision?: MachineDecision | null
  machine_request_id?: string | null
  final_decision?: string | null
  submitter_id?: number | null
  submitter_name?: string | null
  assignee_id?: number | null
  assignee_name?: string | null
  hits: MachineHit[]
  violation_tags: Array<Record<string, unknown>>
  summary?: string | null
  requested_at?: string | null
  finished_at?: string | null
  ip?: string | null
  account_id?: string | null
  bailian_request_id?: string | null
  data_id?: string | null
}

export interface ReviewFilters {
  review_type?: 'human' | 'machine'
  material_type?: DetectionModality
  strategy_code?: string
  task_id?: number
  machine_request_id?: string
  data_id?: string
  final_decision?: ReviewDecision
  page?: number
  size?: number
}
