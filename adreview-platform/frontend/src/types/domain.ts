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

export interface AuditPointEntry {
  label: string
  description?: string
}

export interface MaterialVersion {
  id: number
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
  tag_id: string
  tag_snapshot: ReviewAssignmentTagSnapshot
  created_at: string
}

export interface ReviewAssignment {
  id: number
  public_id?: string
  task_id: number
  assignee_id: number
  decision: ReviewDecision
  note?: string | null
  decided_at?: string | null
  tags?: ReviewAssignmentTag[]
  audit_items?: ReviewAssignmentAuditItem[]
}

export interface ReviewAssignmentAuditItem {
  id: number
  public_id?: string
  audit_item_id: number
  item_snapshot: {
    id: number
    package_code: string
    code: string
    name_cn: string
    aliases?: string[]
    is_enabled: boolean
    is_builtin: boolean
  }
  created_at: string
}

export interface ReviewTask {
  id: number
  public_id?: string
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
  /** LLM 自评或本地词库标注的风险等级 */
  risk?: string | null
  /** "llm" or "local_wordset" */
  source?: 'llm' | 'local_wordset' | string
}

export interface AgentStrategyRef {
  id: number
  public_id?: string
  code: string
  name: string
}

export interface AgentRuleHit {
  rule_id: number
  label: string
  label_cn: string
  threshold: number
  matched: boolean
  /** "llm" (default) or "local_wordset" — 本地词库命中时为后者 */
  source?: 'llm' | 'local_wordset' | string
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
  public_id?: string
  package_id: number
  material_id: number
  position: number
  review_task_id: number | null
  material: Material | null
}

export interface MaterialPackage {
  id: number
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
  position: number
  stage_key: string
  name: string
  required_role: string
  mode: string
  status: string
}

export interface WorkflowInstance {
  id: number
  public_id?: string
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
  public_id?: string
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
  high_risk_content_count: number
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
  public_id?: string
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
  public_id?: string
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
  root_admin: '根管理员',
}

export type MergedRoleKey = 'staff' | 'admin' | 'superadmin' | 'root_admin'

export const STAFF_SUBROLES: ReadonlyArray<UserRole> = ['submitter', 'reviewer', 'mlr']

export const MERGED_ROLE_LABELS: Record<MergedRoleKey, string> = {
  staff: '业务员',
  admin: '管理员',
  superadmin: '超级管理员',
  root_admin: '根管理员',
}

export const MERGED_ROLE_OPTIONS: ReadonlyArray<{ value: MergedRoleKey; label: string }> = [
  { value: 'staff', label: MERGED_ROLE_LABELS.staff },
  { value: 'admin', label: MERGED_ROLE_LABELS.admin },
  { value: 'superadmin', label: MERGED_ROLE_LABELS.superadmin },
  { value: 'root_admin', label: MERGED_ROLE_LABELS.root_admin },
]

export function toMergedRoleKey(role: UserRole): MergedRoleKey {
  if (role === 'submitter' || role === 'reviewer' || role === 'mlr') return 'staff'
  if (role === 'admin') return 'admin'
  if (role === 'superadmin') return 'superadmin'
  return 'root_admin'
}

export function pickPrimaryStaffSubrole(): UserRole {
  return 'submitter'
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
  text: '文本',
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
  /** 区间形态：低风险分 = [min, max]（下限 0~上限，上限 = 中 min - 0.01） */
  low_threshold_min?: number
  low_threshold_max?: number
  /** 区间形态：中风险分 = [min, max] */
  medium_threshold_min?: number
  medium_threshold_max?: number
  /** 区间形态：高风险分 = [min, max] */
  high_threshold_min?: number
  high_threshold_max?: number
}

/** 策略级「大模型审核能力」开关（不区分媒体类型）+ 选定的已激活大模型。 */
export interface LlmReviewConfig {
  is_enabled: boolean
  /** 资源库中已激活的大模型 ID；None 表示启用但未选模型。 */
  model_id: number | null
  /**
   * 后端按策略所启用的 items 推算：
   * - 当策略涉及图片 / 音频 / 视频 / 文档等非纯文本媒体，而所选模型不覆盖对应 modality 时为 true。
   * - 前端据此展示「请选择支持多模态的大模型」提示。
   */
  needs_multimodal_hint: boolean
}

export interface StrategyEnabledPointsMeta {
  total: number
  enabled: number
  disabled: number
  has_overrides: boolean
}

export interface Strategy {
  id: number
  public_id?: string
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
  llm_review?: LlmReviewConfig
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
  llm_review?: LlmReviewConfig
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
  llm_review?: LlmReviewConfig
}

export interface StrategyValidateResult {
  ok: boolean
  warnings: string[]
  checked_at: string
}

export type ServiceScope = "业务场景" | "特殊场景" | "通用场景" | "AIGC场景" | "百炼场景"

export interface ServiceCategory {
  id: number
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
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
  public_id?: string
  code: string
  name: string
  kind?: WordSetKind | null
  group?: WordSetGroup
  action?: WordSetAction
}

export type RiskLevel = '高风险' | '中风险' | '低风险' | '敏感' | '无风险'

export interface HumanReviewConfig {
  id: number
  public_id?: string
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

export interface AuditItemActiveModelVersion {
  version_id: number
  model_id: number
  model_code: string
  model_name: string
  version_no: number
  version_label: string | null
}

export interface AuditItemActiveLargeModel {
  model_id: number
  model_code: string
  model_name: string
}

export interface AuditItem {
  id: number
  public_id?: string
  package_code: string
  code: string
  name_cn: string
  /** 审核项对应的小模型分类（与小模型 small_category 枚举对齐）。NULL=无匹配小模型。 */
  small_category: string | null
  aliases: string[]
  description: string | null
  sort_order: number
  is_enabled: boolean
  is_builtin: boolean
  point_count: number
  /** 「关联自定义图库词库」上移至审核项；同 item 下须共享单一 library_type。 */
  linked_libraries: AuditItemLinkedLibrary[]
  /** 通用规则「生效小模型版本」指针 — 仅 is_builtin=true 时可写。 */
  active_small_model_version_id: number | null
  active_model_version: AuditItemActiveModelVersion | null
  /** 个性化规则「生效大模型」指针 — 仅 is_builtin=false 时可写。 */
  active_large_model_id: number | null
  active_large_model: AuditItemActiveLargeModel | null
  /** 个性化规则「关联知识文档」ID 列表（多选）— 仅 is_builtin=false 时可写。 */
  knowledge_document_ids: number[]
  /** 「审核 Agent」共享阈值 — 仅 is_builtin=false 的自定义 item 可写。 */
  low_threshold_min: number | null
  medium_threshold_min: number | null
  high_threshold_min: number | null
  created_at: string
  updated_at: string | null
}

export interface AuditItemLinkedLibrary {
  library_id: number
  library_type: string
  code: string
  name: string
  group_id: number | null
  group_name: string | null
  sort_order: number
}

export interface AuditItemCreate {
  name_cn: string
  aliases?: string[]
  description?: string
  sort_order?: number
  is_enabled?: boolean
  /** PATCH semantics: undefined=不动；[]=清空；[非空]=全量替换 */
  linked_library_ids?: number[]
  /** 个性化规则「关联知识文档」(多选) */
  knowledge_document_ids?: number[]
}

export interface AuditItemUpdate {
  name_cn?: string
  aliases?: string[]
  description?: string
  sort_order?: number
  is_enabled?: boolean
  /** PATCH semantics: undefined=不动；[]=清空；[非空]=全量替换 */
  linked_library_ids?: number[]
  /**
   * 通用规则「切换生效小模型版本」；个性化规则「绑定运行此 prompt 的小模型版本」。
   * null=清空。
   */
  active_small_model_version_id?: number | null
  /**
   * 个性化规则「切换生效大模型」(LLM，作为 prompt 执行器)。
   * null=清空。通用规则不可写。
   */
  active_large_model_id?: number | null
  /** 个性化规则「关联知识文档」(多选); undefined=不动, []=清空, [非空]=替换 */
  knowledge_document_ids?: number[]
  /** 「审核 Agent」共享阈值(仅 is_builtin=false 可写); 不存 max。 */
  low_threshold_min?: number
  medium_threshold_min?: number
  high_threshold_min?: number
}

export type AuditPointRisk = '低风险' | '中风险' | '高风险'

export interface AuditPoint {
  id: number
  public_id?: string
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
  sort_order: number
  /** 来源文件 ID（仅由「自定义规则 Agent」上传文件解析时写入） */
  source_document_id: number | null
  /** 原文片段（LLM 解析时记录） */
  source_quote: string | null
  /** 结构化文件行号 */
  source_line_no: number | null
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
}

export interface AuditPointUpdate {
  label_cn?: string
  description?: string
  medium_threshold?: number
  high_threshold?: number
  low_threshold_min?: number
  low_threshold_max?: number
  medium_threshold_min?: number
  medium_threshold_max?: number
  high_threshold_min?: number
  high_threshold_max?: number
  scope_text?: string
  risk_level?: AuditPointRisk
  is_enabled?: boolean
  custom_wordset_id?: number
  sort_order?: number
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
  public_id?: string
  library_id: number
  word: string | null
  trigger?: string | null
  reply?: string | null
  pairs?: Array<{ trigger: string; reply: string }>
  is_deleted: boolean
}

export interface ReplyLibraryItem {
  id: number
  public_id?: string
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

// 呈现内容(text/image/audio/video) — 与 DetectionModality 的差异:
// pdf 在呈现内容维度折叠到 text；audio 不在 DetectionModality 内，
// 由 material_versions.mime_type 派生。
export type ContentMedia = 'text' | 'image' | 'audio' | 'video'

export const CONTENT_MEDIA_OPTIONS: { value: ContentMedia; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
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

export type MachineReviewFeedbackKind = 'false_positive' | 'false_negative'

export interface MachineReviewFeedback {
  id: number
  public_id?: string | null
  task_id: number
  kind: MachineReviewFeedbackKind
  note?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at: string
}

export interface MachineReviewRecord {
  id: number
  public_id?: string
  title?: string | null
  review_type?: string | null
  final_decision?: string | null
  material_id?: number | null
  material_version_id?: number | null
  material_version_public_id?: string | null
  material_type?: DetectionModality | string | null
  content_media?: ContentMedia | null
  preview_url?: string | null
  mime_type?: string | null
  text_body?: string | null
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
  last_feedback?: MachineReviewFeedback | null
}

export interface AdvancedCondition {
  op: 'contains' | 'not_contains'
  value: string
}

export interface QueryFilters {
  start?: string
  end?: string
  material_types?: DetectionModality[]
  content_medias?: ContentMedia[]
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
  | 'task_title'
  | 'strategy_name'
  | 'machine_decision'
  | 'feedback'
  | 'material_type'
  | 'request_id'
  | 'task_id'
  | 'labels'
  | 'risk_level'
  | 'requested_at'
  | 'ip'
  | 'account_id'
  | 'content_preview'

export interface QueryColumnDef {
  key: QueryColumnKey
  title: string
  defaultVisible: boolean
  tooltip?: string
}

export const QUERY_COLUMNS: QueryColumnDef[] = [
  { key: 'task_title', title: '任务名称', defaultVisible: true },
  { key: 'strategy_name', title: '策略名称', defaultVisible: true },
  { key: 'machine_decision', title: '检测结果', defaultVisible: true },
  { key: 'feedback', title: '反馈结果', defaultVisible: true },
  {
    key: 'material_type',
    title: '审核类型',
    defaultVisible: true,
    tooltip: '审核通道类型：指请求走的是文本/图片/视频/文件哪条审核链路',
  },
  {
    key: 'content_preview',
    title: '素材内容',
    defaultVisible: true,
    tooltip: '素材内容预览：文本摘要 / 图片缩略图 / 音视频入口，点击查看完整',
  },
  { key: 'request_id', title: 'Request ID', defaultVisible: false },
  { key: 'task_id', title: 'Task ID', defaultVisible: false },
  { key: 'labels', title: '命中审核点及置信度', defaultVisible: false },
  { key: 'risk_level', title: '风险等级', defaultVisible: false },
  { key: 'requested_at', title: '请求时间', defaultVisible: false },
  { key: 'ip', title: 'IP', defaultVisible: false },
  { key: 'account_id', title: 'AccountId', defaultVisible: false },
]

export const DEFAULT_VISIBLE_COLUMNS: QueryColumnKey[] = QUERY_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.key)

export const QUERY_COLUMNS_SCHEMA_VERSION = 2

// ─── 复审队列 (/query/review) — 卡片视图，只读 ────────────────────────────────

export interface ReviewRecord {
  id: number
  public_id?: string
  title?: string | null
  review_type?: string | null
  material_id: number
  material_version_id: number
  material_version_public_id?: string | null
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
  last_feedback?: MachineReviewFeedback | null
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

// ─── 内容审核业务知识库 ───

export type KnowledgeDocumentStatus = 'draft' | 'active' | 'archived'

export const KNOWLEDGE_DOCUMENT_STATUS_OPTIONS: {
  value: KnowledgeDocumentStatus
  label: string
  color: string
}[] = [
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'active', label: '已启用', color: 'green' },
  { value: 'archived', label: '已归档', color: 'default' },
]

export type KnowledgeDocumentSourceType = 'upload' | 'url' | 'manual'

export const KNOWLEDGE_DOCUMENT_SOURCE_TYPE_LABELS: Record<KnowledgeDocumentSourceType, string> = {
  upload: '本地上传',
  url: '外部链接',
  manual: '仅元数据',
}

export interface KnowledgeDocumentVersion {
  id: number
  public_id?: string
  document_id: number
  version_no: number
  original_filename: string | null
  mime_type: string | null
  file_size: number | null
  sha256: string | null
  source_url: string | null
  metadata: Record<string, unknown>
  created_by_id: number | null
  created_by_name?: string | null
  created_at: string
}

export interface KnowledgeDocument {
  id: number
  public_id?: string
  code: string
  title: string
  description: string | null
  tags: string[]
  issued_at: string | null
  status: KnowledgeDocumentStatus
  source_type: KnowledgeDocumentSourceType
  source_url: string | null
  current_version_id: number | null
  current_version?: KnowledgeDocumentVersion | null
  owner_id: number | null
  owner_name?: string | null
  created_by_id: number | null
  created_by_name?: string | null
  updated_by_id: number | null
  updated_by_name?: string | null
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string | null
}

export interface KnowledgeDocumentListItem {
  id: number
  public_id?: string
  code: string
  title: string
  tags: string[]
  source_type: KnowledgeDocumentSourceType
  issued_at: string | null
  status: KnowledgeDocumentStatus
  current_version_id: number | null
  current_version_no?: number | null
  current_version?: KnowledgeDocumentVersion | null
  owner_id: number | null
  owner_name?: string | null
  updated_at: string | null
  created_at: string
}

export interface KnowledgeDocumentCreate {
  code?: string
  title: string
  description?: string | null
  tags?: string[]
  issued_at?: string | null
  status?: KnowledgeDocumentStatus
  source_type: KnowledgeDocumentSourceType
  source_url?: string | null
}

export interface KnowledgeDocumentUpdate {
  title?: string
  description?: string | null
  tags?: string[]
  issued_at?: string | null
  status?: KnowledgeDocumentStatus
  source_url?: string | null
}

// ─── 模型库 ───

export type RegisteredModelProvider =
  | 'openai'
  | 'anthropic'
  | 'bailian'
  | 'deepseek'
  | 'self-hosted'
  | 'custom'

export const REGISTERED_MODEL_PROVIDER_PRESETS: {
  value: RegisteredModelProvider
  label: string
  defaultEndpoint: string | null
  protocol: 'openai-compatible' | 'anthropic-messages' | 'custom'
}[] = [
  { value: 'openai', label: 'OpenAI', defaultEndpoint: 'https://api.openai.com/v1', protocol: 'openai-compatible' },
  { value: 'anthropic', label: 'Anthropic', defaultEndpoint: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  { value: 'bailian', label: '阿里百炼 (DashScope)', defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai-compatible' },
  { value: 'deepseek', label: 'DeepSeek', defaultEndpoint: 'https://api.deepseek.com/v1', protocol: 'openai-compatible' },
  { value: 'self-hosted', label: '自建 / 私有部署', defaultEndpoint: null, protocol: 'openai-compatible' },
  { value: 'custom', label: '自定义', defaultEndpoint: null, protocol: 'custom' },
]

export type RegisteredModelModality = 'text' | 'image' | 'audio' | 'video'

export const REGISTERED_MODEL_MODALITY_OPTIONS: {
  value: RegisteredModelModality
  label: string
}[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
]

export type RegisteredModelKind = 'large' | 'small'

export const REGISTERED_MODEL_KIND_OPTIONS: { value: RegisteredModelKind; label: string; color: string }[] = [
  { value: 'large', label: '大模型', color: 'magenta' },
  { value: 'small', label: '小模型', color: 'blue' },
]

export type SmallModelCategory =
  | 'politics'
  | 'terrorism'
  | 'porn'
  | 'illicit'
  | 'ad'
  | 'religion'
  | 'ad_law'
  | 'abuse'
  | 'unhealthy'

export const SMALL_MODEL_CATEGORY_OPTIONS: { value: SmallModelCategory; label: string; color: string }[] = [
  { value: 'politics', label: '涉政', color: 'red' },
  { value: 'terrorism', label: '涉恐', color: 'red' },
  { value: 'porn', label: '涉黄', color: 'red' },
  { value: 'illicit', label: '违禁', color: 'red' },
  { value: 'ad', label: '广告', color: 'orange' },
  { value: 'religion', label: '宗教', color: 'orange' },
  { value: 'ad_law', label: '广告法', color: 'orange' },
  { value: 'abuse', label: '辱骂', color: 'volcano' },
  { value: 'unhealthy', label: '不良', color: 'volcano' },
]

export const SMALL_MODEL_CATEGORY_LABEL: Record<SmallModelCategory, string> = SMALL_MODEL_CATEGORY_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<SmallModelCategory, string>,
)

export type SmallModelModality = 'text' | 'image'

export const SMALL_MODEL_MODALITY_OPTIONS: { value: SmallModelModality; label: string; color: string }[] = [
  { value: 'text', label: '文本', color: 'blue' },
  { value: 'image', label: '图片', color: 'geekblue' },
]

export const SMALL_MODEL_MODALITY_LABEL: Record<SmallModelModality, string> = SMALL_MODEL_MODALITY_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<SmallModelModality, string>,
)

export type LargeModelCategory = 'text' | 'multimodal' | 'other'

export const LARGE_MODEL_CATEGORY_OPTIONS: {
  value: LargeModelCategory
  label: string
  color: string
}[] = [
  { value: 'text', label: '文本模型', color: 'blue' },
  { value: 'multimodal', label: '多模态模型', color: 'purple' },
  { value: 'other', label: '其他模型', color: 'default' },
]

export const LARGE_MODEL_CATEGORY_LABEL: Record<LargeModelCategory, string> = LARGE_MODEL_CATEGORY_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label
    return acc
  },
  {} as Record<LargeModelCategory, string>,
) as Record<LargeModelCategory, string>

export type RegisteredModelRegistrationMethod = 'remote_api' | 'uploaded_file'

export type RegisteredModelStatus =
  | 'draft'
  | 'validating'
  | 'active'
  | 'inactive'
  | 'failed'
  | 'archived'

export const REGISTERED_MODEL_STATUS_OPTIONS: {
  value: RegisteredModelStatus
  label: string
  color: string
}[] = [
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'validating', label: '校验中', color: 'processing' },
  { value: 'active', label: '已激活', color: 'green' },
  { value: 'inactive', label: '已停用', color: 'default' },
  { value: 'failed', label: '校验失败', color: 'red' },
  { value: 'archived', label: '已归档', color: 'default' },
]

export interface RegisteredModelValidationLog {
  checked_at: string
  ok: boolean
  http_status: number | null
  latency_ms: number | null
  message: string
}

export interface ArtifactUploadResponse {
  storage_key: string
  filename: string
  mime_type: string | null
  size: number
  sha256: string
}

export interface RegisteredModelVersion {
  id: number
  public_id?: string
  model_id: number
  version_no: number
  version_label: string | null
  notes: string | null
  large_category: LargeModelCategory | null
  registration_method: RegisteredModelRegistrationMethod
  provider: string | null
  model_name: string | null
  endpoint_url: string | null
  config: Record<string, unknown>
  credential_id: number | null
  artifact_storage_key: string | null
  artifact_filename: string | null
  artifact_mime_type: string | null
  artifact_size: number | null
  artifact_sha256: string | null
  status: string
  validation_log: RegisteredModelValidationLog[] | null
  created_by_id: number | null
  created_by_name?: string | null
  created_at: string
}

export interface RegisteredProviderSummary {
  id: number
  public_id?: string
  display_name: string
  provider_preset: RegisteredModelProvider | null
  endpoint_url: string | null
  masked_token: string | null
  status: string
}

export interface RegisteredModel {
  id: number
  public_id?: string
  code: string
  name: string
  description: string | null
  kind: RegisteredModelKind
  small_category: SmallModelCategory | null
  modality: SmallModelModality | null
  large_category: LargeModelCategory | null
  provider_id: number | null
  provider: RegisteredProviderSummary | null
  provider_preset: RegisteredModelProvider | null
  model_name: string | null
  max_output_tokens: number | null
  registration_method: RegisteredModelRegistrationMethod
  status: RegisteredModelStatus
  version: string | null
  config: Record<string, unknown>
  credential_label?: string | null
  is_deleted: boolean
  deleted_at: string | null
  owner_id: number | null
  owner_name?: string | null
  created_by_id: number | null
  created_by_name?: string | null
  updated_by_id: number | null
  updated_by_name?: string | null
  current_version_id: number | null
  current_version_no: number | null
  current_version_label: string | null
  current_version?: RegisteredModelVersion | null
  created_at: string
  updated_at: string | null
}

export interface RegisteredModelListItem {
  id: number
  public_id?: string
  code: string
  name: string
  kind: RegisteredModelKind
  small_category: SmallModelCategory | null
  modality: SmallModelModality | null
  large_category: LargeModelCategory | null
  provider_id: number | null
  provider_preset: RegisteredModelProvider | null
  provider_label: string | null
  model_name: string | null
  max_output_tokens: number | null
  registration_method: RegisteredModelRegistrationMethod
  status: RegisteredModelStatus
  version: string | null
  current_version_id: number | null
  current_version_no: number | null
  current_version_label: string | null
  // 小模型专属：当前版本 artifact 摘要（来自 list 接口）
  artifact_filename: string | null
  artifact_size: number | null
  // 小模型专属：当前版本 config（含审核点列表），用于树形展示
  current_version_config: Record<string, unknown> | null
  owner_id: number | null
  owner_name?: string | null
  updated_at: string | null
  created_at: string
}

export interface RegisteredModelCreate {
  code?: string
  name: string
  description?: string | null
  kind?: RegisteredModelKind
  small_category?: SmallModelCategory | null
  modality?: SmallModelModality | null
  large_category?: LargeModelCategory | null
  // 大模型必填；小模型可空（不绑定任何 Provider）
  provider_id?: number | null
  model_name?: string | null
  status?: RegisteredModelStatus
  version?: string | null
  config?: Record<string, unknown>
  // —— 小模型专用 ——
  registration_method?: RegisteredModelRegistrationMethod
  max_output_tokens?: number | null
  artifact?: ArtifactUploadResponse | null
}

export interface RegisteredModelUpdate {
  name?: string
  description?: string | null
  small_category?: SmallModelCategory | null
  modality?: SmallModelModality | null
  large_category?: LargeModelCategory | null
  model_name?: string | null
  max_output_tokens?: number | null
  status?: RegisteredModelStatus
  version?: string | null
  config?: Record<string, unknown>
}

export interface RegisteredModelVersionCreate {
  version_label?: string | null
  notes?: string | null
  large_category?: LargeModelCategory | null
  modality?: SmallModelModality | null
  model_name?: string | null
  config?: Record<string, unknown>
  // —— 小模型上传新版本时携带 ——
  artifact?: ArtifactUploadResponse | null
}

// ─── Provider（4 级实体） ───

export interface ProviderInitialModel {
  model_name: string
  name?: string
  large_category: LargeModelCategory
  description?: string
  version?: string
}

export interface RegisteredProvider {
  id: number
  public_id?: string
  display_name: string
  description: string | null
  provider_preset: RegisteredModelProvider | null
  endpoint_url: string
  config: Record<string, unknown>
  credential_id: number | null
  masked_token: string | null
  credential_label: string | null
  status: 'active' | 'archived'
  model_count: number
  owner_id: number | null
  created_by_id: number | null
  updated_by_id: number | null
  created_at: string
  updated_at: string | null
}

export interface RegisteredProviderDetail extends RegisteredProvider {
  models: RegisteredModelListItem[]
}

export interface RegisteredProviderOption {
  id: number
  display_name: string
  provider_preset: RegisteredModelProvider | null
  endpoint_url: string | null
  masked_token: string | null
  status: 'active' | 'archived'
}

export interface RegisteredProviderCreate {
  display_name: string
  description?: string
  provider_preset?: RegisteredModelProvider | null
  endpoint_url: string
  api_key: string
  initial_models: ProviderInitialModel[]
}

export interface RegisteredProviderUpdate {
  display_name?: string
  description?: string
  provider_preset?: RegisteredModelProvider | null
  endpoint_url?: string
}

export interface RegisteredProviderRotateApiKey {
  api_key: string
}

// ─── 凭证 ───

export interface ResourceCredential {
  id: number
  public_id?: string
  name: string
  provider: string | null
  masked_token: string
  created_by_id: number | null
  created_by_name?: string | null
  created_at: string
}

export interface ResourceCredentialCreate {
  name: string
  provider?: string | null
  token: string
  metadata?: Record<string, unknown>
}

// ─── 上传源文件 (自定义规则 Agent) ───

export type UploadedDocKind = 'structured' | 'llm'

export type UploadedDocStatus = 'pending' | 'parsing' | 'parsed' | 'failed'

export interface UploadedDocument {
  id: number
  item_id: number
  package_code: string
  original_filename: string
  kind: UploadedDocKind
  storage_key: string
  size_bytes: number
  sha256: string | null
  mime_type: string | null
  status: UploadedDocStatus
  parsed_point_count: number
  error_message: string | null
  parsed_at: string | null
  prompt_markdown: string | null
  created_at: string
  updated_at: string | null
}

export interface UploadedDocumentListResponse {
  item_id: number
  documents: UploadedDocument[]
  total_count: number
  parsed_count: number
  failed_count: number
  pending_count: number
}

export interface UploadedDocumentUpdate {
  prompt_markdown?: string | null
}
