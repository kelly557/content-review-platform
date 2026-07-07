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


export type StrategyScope = "default" | "general"

export type MediaTypeKey = "image" | "text" | "audio" | "doc" | "video"

export interface StrategyItemRef {
  media_type: MediaTypeKey
  item_id: number
  is_enabled: boolean
}

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
  enabled_items: StrategyItemRef[]
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
  enabled_items?: StrategyItemRef[]
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
  enabled_items?: StrategyItemRef[]
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
  4: "P4 较低",
  5: "P5 普通",
  6: "P6 备用",
  7: "P7 备用",
  8: "P8 兜底",
  9: "P9 兜底",
  10: "P10 最低",
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

// ─── Libraries v3 (replaces word_sets + image_sets + hardcoded groups) ───

export type LibraryType = 'word' | 'image'

export interface LibraryGroup {
  id: number
  name: string
  description: string | null
  sort_order: number
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string | null
}

export interface LibraryGroupCreate {
  name: string
  description?: string
  sort_order?: number
}

export interface LibraryGroupUpdate {
  name?: string
  description?: string
  sort_order?: number
}

export interface Library {
  id: number
  code: string
  name: string
  library_type: LibraryType
  group_id: number
  group_name: string | null
  description: string | null
  is_active: boolean
  is_deleted: boolean
  deleted_at: string | null
  item_count: number
  ignored_services: string[]
  created_at: string
  updated_at: string | null
}

export interface LibraryListItem {
  id: number
  code: string
  name: string
  library_type: LibraryType
  group_id: number
  group_name: string | null
  description: string | null
  is_active: boolean
  is_deleted: boolean
  item_count: number
  created_at: string
  updated_at: string | null
}

export interface LibraryCreate {
  code?: string
  name: string
  library_type: LibraryType
  group_id: number
  description?: string
  words?: string[]
}

export interface LibraryUpdate {
  name?: string
  group_id?: number
  description?: string
  is_active?: boolean
  ignored_services?: string[]
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

export type RiskLevel = "高风险" | "中风险" | "低风险" | "无风险"

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
  custom_wordset_id: number | null
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
  sort_order?: number
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
// Knowledge Base (知识库)
// ──────────────────────────────────────────────────────────────────────────────

export type KnowledgeScope =
  | '法律法规'
  | '行政规定'
  | '行业规范'
  | '内部政策'

export const KNOWLEDGE_SCOPE_OPTIONS: { value: KnowledgeScope; label: string }[] = [
  { value: '法律法规', label: '法律法规' },
  { value: '行政规定', label: '行政规定' },
  { value: '行业规范', label: '行业规范' },
  { value: '内部政策', label: '内部政策' },
]

export type KnowledgeDocumentStatus =
  | 'draft'
  | 'extracting'
  | 'review'
  | 'imported'
  | 'failed'

export const KNOWLEDGE_STATUS_OPTIONS: {
  value: KnowledgeDocumentStatus
  label: string
  color: string
}[] = [
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'extracting', label: '抽取中', color: 'processing' },
  { value: 'review', label: '待审', color: 'warning' },
  { value: 'imported', label: '已导入', color: 'success' },
  { value: 'failed', label: '失败', color: 'error' },
]

export interface KnowledgeDocumentSummary {
  id: string
  title: string
  original_filename: string
  mime_type: string
  file_size: number
  domain: TagDomain
  scope: KnowledgeScope
  tag_ids: string[]
  status: KnowledgeDocumentStatus
  created_at: string
  updated_at: string | null
}

export interface KnowledgeDocumentListResponse {
  items: KnowledgeDocumentSummary[]
  total: number
  page: number
  size: number
}

export interface KnowledgeExtractionSummary {
  id: string
  document_id: string
  round_no: number
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  status: string
  error_message: string | null
  chunk_count: number
  created_at: string
}

export interface KnowledgeDocumentDetail {
  id: string
  title: string
  original_filename: string
  mime_type: string
  file_size: number
  domain: TagDomain
  scope: KnowledgeScope
  tag_ids: string[]
  target_service_code: string | null
  status: KnowledgeDocumentStatus
  error_message: string | null
  created_by_id: number | null
  created_at: string
  updated_at: string | null
  extractions: KnowledgeExtractionSummary[]
}

export interface KnowledgeJudgmentLogic {
  type: 'keyword_match' | 'regex' | 'semantic' | 'threshold'
  expr: string
  params: Record<string, unknown>
}

export interface KnowledgeExtractionPoint {
  id: string
  extraction_id: string
  item_draft_id: string
  code: string
  label: string
  label_cn: string
  description: string | null
  judgment_logic: KnowledgeJudgmentLogic
  judgment_rule: string | null
  judgment_basis: string | null
  risk_level: AuditPointRisk
  medium_threshold: number
  high_threshold: number
  scope_text: string | null
  selected: boolean
  imported_point_id: number | null
  created_at: string
}

export interface KnowledgeExtractionItem {
  id: string
  extraction_id: string
  code: string
  name_cn: string
  aliases: string[]
  description: string | null
  sort_order: number
  selected: boolean
  imported_item_id: number | null
  points: KnowledgeExtractionPoint[]
  created_at: string
}

export interface KnowledgeExtraction {
  id: string
  document_id: string
  round_no: number
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  raw_response: string | null
  status: string
  error_message: string | null
  chunk_count: number
  created_at: string
  items: KnowledgeExtractionItem[]
}

export interface KnowledgeImportRequest {
  item_ids?: string[]
  point_overrides?: Record<string, boolean>
  target_service_code?: string
  enable_imported?: boolean
}

export interface KnowledgeImportResult {
  document_id: string
  extraction_id: string
  service_code: string
  imported_items: number
  imported_points: number
  item_id_map: Record<string, number>
  point_id_map: Record<string, number>
}
