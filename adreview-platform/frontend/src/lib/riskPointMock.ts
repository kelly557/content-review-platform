/**
 * 文本审核 mock 数据
 * --------------------------------------------------------------
 * 仅当后端 /api/v1/packages/text_audit_pro/items 或 /points 接口
 * 5xx/网络失败时作为兜底使用，便于离线演示与本地开发。
 *
 * ⚠️ 这只是前端占位数据：选择 mock 标签提交后会因后端 _resolve_risk_point
 * 校验返回 404，提交失败时会自动还原输入并提示用户。
 */

export interface MockRiskItem {
  id: number
  name: string
}

export interface MockRiskPoint {
  id: number
  item_id: number
  label: string
  label_cn: string
  risk_level?: '低风险' | '中风险' | '高风险'
  is_enabled?: boolean
}

/** mock 数据 ID 区间前缀（80000+ / 9000+），用于前端识别"演示数据" */
export const MOCK_RISK_POINT_ID_PREFIX = 80000
export const MOCK_RISK_ITEM_ID_PREFIX = 9000

export function isMockRiskPointId(id: number | null | undefined): boolean {
  return typeof id === 'number' && id >= MOCK_RISK_POINT_ID_PREFIX
}

/** 文本审核一级审核项（mock） */
export const MOCK_TEXT_RISK_ITEMS: MockRiskItem[] = [
  { id: 9001, name: '涉政' },
  { id: 9002, name: '暴恐' },
  { id: 9003, name: '色情低俗' },
  { id: 9004, name: '广告法' },
  { id: 9005, name: '未成年人' },
]

/**
 * 图片审核一级审核项（mock） — 2026-07-30 新增
 *
 * 图片审核 tab 在 mock 兜底场景下没有专属 item 列表,直接复用文本的 item
 * 加上「图文」(image tab 子分类入口)。由 auditItems.ts 的 asMockAuditItems
 * 在 packageCode 为 image 时调用。
 */
export const MOCK_IMAGE_RISK_ITEMS: MockRiskItem[] = [
  ...MOCK_TEXT_RISK_ITEMS,
  { id: 9006, name: '图文' },
]

/** 文本审核二级风险标签 / 审核点（mock） */
export const MOCK_TEXT_RISK_POINTS: MockRiskPoint[] = [
  // 涉政 (9001)
  {
    id: 80001,
    item_id: 9001,
    label: 'leaders_name',
    label_cn: '领导人姓名',
    risk_level: '高风险',
    is_enabled: true,
  },
  {
    id: 80002,
    item_id: 9001,
    label: 'territory_sovereignty',
    label_cn: '领土主权',
    risk_level: '高风险',
    is_enabled: true,
  },
  {
    id: 80003,
    item_id: 9001,
    label: 'political_event',
    label_cn: '敏感政治事件',
    risk_level: '高风险',
    is_enabled: true,
  },
  // 暴恐 (9002)
  {
    id: 80011,
    item_id: 9002,
    label: 'violent_bloody',
    label_cn: '暴力血腥',
    risk_level: '高风险',
    is_enabled: true,
  },
  {
    id: 80012,
    item_id: 9002,
    label: 'weapon_ammunition',
    label_cn: '武器弹药',
    risk_level: '高风险',
    is_enabled: true,
  },
  // 色情低俗 (9003)
  {
    id: 80021,
    item_id: 9003,
    label: 'sexual_suggestion',
    label_cn: '性暗示',
    risk_level: '中风险',
    is_enabled: true,
  },
  {
    id: 80022,
    item_id: 9003,
    label: 'nudity',
    label_cn: '露点',
    risk_level: '高风险',
    is_enabled: true,
  },
  {
    id: 80023,
    item_id: 9003,
    label: 'vulgar_language',
    label_cn: '低俗用语',
    risk_level: '中风险',
    is_enabled: true,
  },
  // 广告法 (9004)
  {
    id: 80031,
    item_id: 9004,
    label: 'false_claim',
    label_cn: '虚假宣传',
    risk_level: '中风险',
    is_enabled: true,
  },
  {
    id: 80032,
    item_id: 9004,
    label: 'absolute_term',
    label_cn: '极限用语',
    risk_level: '中风险',
    is_enabled: true,
  },
  // 未成年人 (9005)
  {
    id: 80041,
    item_id: 9005,
    label: 'minor_protection',
    label_cn: '未成年人保护',
    risk_level: '中风险',
    is_enabled: true,
  },
  {
    id: 80042,
    item_id: 9005,
    label: 'parental_consent',
    label_cn: '未成年人消费引导',
    risk_level: '中风险',
    is_enabled: true,
  },
]

/**
 * 三级风险标签（sub-审核点）mock 数据 — 2026-07-30 新增
 *
 * - 挂在二级审核点（AuditPoint）之下，每个 sub 自带 3 档风险分阈值
 * - 仅前端 mock，不参与后端 API;刷新页面状态重置
 * - 风险分阈值（low/medium/high）由 Box A「平台内置规则」表格的 sub 块内 RangeMinOnlyInput 编辑
 */
export interface MockSubAuditPoint {
  id: number
  point_id: number
  l1_label: string
  l2_label: string
  l3_label: string
  label_cn: string
  low_threshold: number
  medium_threshold: number
  high_threshold: number
  is_enabled: boolean
  sort_order: number
}

export const MOCK_SUB_AUDIT_POINTS: MockSubAuditPoint[] = [
  // 涉政 > 领导人姓名 (point_id=80001)
  {
    id: 8000101,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_正面提及',
    label_cn: '涉政_一号领导_正面提及',
    low_threshold: 20,
    medium_threshold: 60,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8000102,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_负面提及',
    label_cn: '涉政_一号领导_负面提及',
    low_threshold: 10,
    medium_threshold: 40,
    high_threshold: 80,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8000103,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_一号领导头像',
    label_cn: '涉政_一号领导_一号领导头像',
    low_threshold: 30,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 3,
  },
  // 涉政 > 领土主权 (point_id=80002)
  {
    id: 8000201,
    point_id: 80002,
    l1_label: '涉政',
    l2_label: '涉政_领土主权',
    l3_label: '涉政_领土主权_大陆',
    label_cn: '涉政_领土主权_大陆',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8000202,
    point_id: 80002,
    l1_label: '涉政',
    l2_label: '涉政_领土主权',
    l3_label: '涉政_领土主权_港澳台',
    label_cn: '涉政_领土主权_港澳台',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 2,
  },
  // 涉政 > 敏感政治事件 (point_id=80003)
  {
    id: 8000301,
    point_id: 80003,
    l1_label: '涉政',
    l2_label: '涉政_敏感事件',
    l3_label: '涉政_敏感事件_敏感纪念日',
    label_cn: '涉政_敏感事件_敏感纪念日',
    low_threshold: 30,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 1,
  },
  // 暴恐 > 暴力血腥 (point_id=80011)
  {
    id: 8001101,
    point_id: 80011,
    l1_label: '暴恐',
    l2_label: '暴恐_暴力血腥',
    l3_label: '暴恐_暴力血腥_肢解画面',
    label_cn: '暴恐_暴力血腥_肢解画面',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8001102,
    point_id: 80011,
    l1_label: '暴恐',
    l2_label: '暴恐_暴力血腥',
    l3_label: '暴恐_暴力血腥_殴打场景',
    label_cn: '暴恐_暴力血腥_殴打场景',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 2,
  },
  // 色情低俗 > 性暗示 (point_id=80021)
  {
    id: 8002101,
    point_id: 80021,
    l1_label: '色情低俗',
    l2_label: '色情低俗_性暗示',
    l3_label: '色情低俗_性暗示_擦边描述',
    label_cn: '色情低俗_性暗示_擦边描述',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 1,
  },
  // 暴恐 > 武器弹药 (point_id=80012)
  {
    id: 8001201,
    point_id: 80012,
    l1_label: '暴恐',
    l2_label: '暴恐_武器弹药',
    l3_label: '暴恐_武器弹药_枪支器械',
    label_cn: '暴恐_武器弹药_枪支器械',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8001202,
    point_id: 80012,
    l1_label: '暴恐',
    l2_label: '暴恐_武器弹药',
    l3_label: '暴恐_武器弹药_弹药描述',
    label_cn: '暴恐_武器弹药_弹药描述',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8001203,
    point_id: 80012,
    l1_label: '暴恐',
    l2_label: '暴恐_武器弹药',
    l3_label: '暴恐_武器弹药_爆炸物',
    label_cn: '暴恐_武器弹药_爆炸物',
    low_threshold: 35,
    medium_threshold: 65,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 3,
  },
  // 色情低俗 > 露点 (point_id=80022)
  {
    id: 8002201,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_胸部',
    label_cn: '色情低俗_露点_胸部',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8002202,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_臀部',
    label_cn: '色情低俗_露点_臀部',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8002203,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_生殖器',
    label_cn: '色情低俗_露点_生殖器',
    low_threshold: 35,
    medium_threshold: 65,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 3,
  },
  // 色情低俗 > 低俗用语 (point_id=80023)
  {
    id: 8002301,
    point_id: 80023,
    l1_label: '色情低俗',
    l2_label: '色情低俗_低俗用语',
    l3_label: '色情低俗_低俗用语_脏话',
    label_cn: '色情低俗_低俗用语_脏话',
    low_threshold: 15,
    medium_threshold: 45,
    high_threshold: 80,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8002302,
    point_id: 80023,
    l1_label: '色情低俗',
    l2_label: '色情低俗_低俗用语',
    l3_label: '色情低俗_低俗用语_侮辱性',
    label_cn: '色情低俗_低俗用语_侮辱性',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 2,
  },
  // 广告法 > 虚假宣传 (point_id=80031)
  {
    id: 8003101,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_功效保证',
    label_cn: '广告法_虚假宣传_功效保证',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8003102,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_治疗功能',
    label_cn: '广告法_虚假宣传_治疗功能',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8003103,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_夸大产品',
    label_cn: '广告法_虚假宣传_夸大产品',
    low_threshold: 18,
    medium_threshold: 48,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 3,
  },
  // 广告法 > 极限用语 (point_id=80032)
  {
    id: 8003201,
    point_id: 80032,
    l1_label: '广告法',
    l2_label: '广告法_极限用语',
    l3_label: '广告法_极限用语_最_第一_顶级',
    label_cn: '广告法_极限用语_最/第一/顶级',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8003202,
    point_id: 80032,
    l1_label: '广告法',
    l2_label: '广告法_极限用语',
    l3_label: '广告法_极限用语_唯一',
    label_cn: '广告法_极限用语_唯一',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8003203,
    point_id: 80032,
    l1_label: '广告法',
    l2_label: '广告法_极限用语',
    l3_label: '广告法_极限用语_百分百',
    label_cn: '广告法_极限用语_百分百',
    low_threshold: 18,
    medium_threshold: 48,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 3,
  },
  // 未成年人 > 未成年人保护 (point_id=80041)
  {
    id: 8004101,
    point_id: 80041,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人保护',
    l3_label: '未成年人_未成年人保护_未成年形象',
    label_cn: '未成年人_未成年人保护_未成年形象',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8004102,
    point_id: 80041,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人保护',
    l3_label: '未成年人_未成年人保护_未成年人受虐',
    label_cn: '未成年人_未成年人保护_未成年人受虐',
    low_threshold: 35,
    medium_threshold: 65,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 2,
  },
  // 未成年人 > 未成年人消费引导 (point_id=80042)
  {
    id: 8004201,
    point_id: 80042,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人消费引导',
    l3_label: '未成年人_未成年人消费引导_烟酒广告',
    label_cn: '未成年人_未成年人消费引导_烟酒广告',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 1,
  },
  {
    id: 8004202,
    point_id: 80042,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人消费引导',
    l3_label: '未成年人_未成年人消费引导_游戏充值',
    label_cn: '未成年人_未成年人消费引导_游戏充值',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 2,
  },
  // ──────────────────────────────────────────────────────────────────────
  // 2026-07-30 第二轮：每个审核点再补 2-3 条 sub，共 +35 条
  // ──────────────────────────────────────────────────────────────────────
  // 涉政 > 领导人姓名 (point_id=80001) 补 3 条 → 6 总
  {
    id: 8000104,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_负面相关事件',
    label_cn: '涉政_一号领导_负面相关事件',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8000105,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_负面绰号',
    label_cn: '涉政_一号领导_负面绰号',
    low_threshold: 15,
    medium_threshold: 45,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 5,
  },
  {
    id: 8000106,
    point_id: 80001,
    l1_label: '涉政',
    l2_label: '涉政_一号领导',
    l3_label: '涉政_一号领导_正面绰号',
    label_cn: '涉政_一号领导_正面绰号',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 6,
  },
  // 涉政 > 领土主权 (point_id=80002) 补 3 条 → 5 总
  {
    id: 8000203,
    point_id: 80002,
    l1_label: '涉政',
    l2_label: '涉政_领土主权',
    l3_label: '涉政_领土主权_台湾',
    label_cn: '涉政_领土主权_台湾',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8000204,
    point_id: 80002,
    l1_label: '涉政',
    l2_label: '涉政_领土主权',
    l3_label: '涉政_领土主权_新疆',
    label_cn: '涉政_领土主权_新疆',
    low_threshold: 28,
    medium_threshold: 58,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8000205,
    point_id: 80002,
    l1_label: '涉政',
    l2_label: '涉政_领土主权',
    l3_label: '涉政_领土主权_西藏',
    label_cn: '涉政_领土主权_西藏',
    low_threshold: 28,
    medium_threshold: 58,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 5,
  },
  // 涉政 > 敏感政治事件 (point_id=80003) 补 3 条 → 4 总
  {
    id: 8000302,
    point_id: 80003,
    l1_label: '涉政',
    l2_label: '涉政_敏感事件',
    l3_label: '涉政_敏感事件_敏感纪念日_其他',
    label_cn: '涉政_敏感事件_敏感纪念日_其他',
    low_threshold: 28,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8000303,
    point_id: 80003,
    l1_label: '涉政',
    l2_label: '涉政_敏感事件',
    l3_label: '涉政_敏感事件_周年',
    label_cn: '涉政_敏感事件_周年',
    low_threshold: 25,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8000304,
    point_id: 80003,
    l1_label: '涉政',
    l2_label: '涉政_敏感事件',
    l3_label: '涉政_敏感事件_纪念活动',
    label_cn: '涉政_敏感事件_纪念活动',
    low_threshold: 25,
    medium_threshold: 50,
    high_threshold: 85,
    is_enabled: true,
    sort_order: 4,
  },
  // 暴恐 > 暴力血腥 (point_id=80011) 补 3 条 → 5 总
  {
    id: 8001103,
    point_id: 80011,
    l1_label: '暴恐',
    l2_label: '暴恐_暴力血腥',
    l3_label: '暴恐_暴力血腥_枪击',
    label_cn: '暴恐_暴力血腥_枪击',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8001104,
    point_id: 80011,
    l1_label: '暴恐',
    l2_label: '暴恐_暴力血腥',
    l3_label: '暴恐_暴力血腥_爆炸',
    label_cn: '暴恐_暴力血腥_爆炸',
    low_threshold: 30,
    medium_threshold: 60,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8001105,
    point_id: 80011,
    l1_label: '暴恐',
    l2_label: '暴恐_暴力血腥',
    l3_label: '暴恐_暴力血腥_恐怖袭击',
    label_cn: '暴恐_暴力血腥_恐怖袭击',
    low_threshold: 35,
    medium_threshold: 65,
    high_threshold: 95,
    is_enabled: true,
    sort_order: 5,
  },
  // 暴恐 > 武器弹药 (point_id=80012) 补 2 条 → 5 总
  {
    id: 8001204,
    point_id: 80012,
    l1_label: '暴恐',
    l2_label: '暴恐_武器弹药',
    l3_label: '暴恐_武器弹药_军用装备',
    label_cn: '暴恐_武器弹药_军用装备',
    low_threshold: 28,
    medium_threshold: 58,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8001205,
    point_id: 80012,
    l1_label: '暴恐',
    l2_label: '暴恐_武器弹药',
    l3_label: '暴恐_武器弹药_化学武器',
    label_cn: '暴恐_武器弹药_化学武器',
    low_threshold: 38,
    medium_threshold: 68,
    high_threshold: 95,
    is_enabled: true,
    sort_order: 5,
  },
  // 色情低俗 > 性暗示 (point_id=80021) 补 3 条 → 4 总
  {
    id: 8002102,
    point_id: 80021,
    l1_label: '色情低俗',
    l2_label: '色情低俗_性暗示',
    l3_label: '色情低俗_性暗示_擦边描述_语气',
    label_cn: '色情低俗_性暗示_擦边描述_语气',
    low_threshold: 18,
    medium_threshold: 48,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 2,
  },
  {
    id: 8002103,
    point_id: 80021,
    l1_label: '色情低俗',
    l2_label: '色情低俗_性暗示',
    l3_label: '色情低俗_性暗示_擦边描述_引号',
    label_cn: '色情低俗_性暗示_擦边描述_引号',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8002104,
    point_id: 80021,
    l1_label: '色情低俗',
    l2_label: '色情低俗_性暗示',
    l3_label: '色情低俗_性暗示_擦边描述_谐音',
    label_cn: '色情低俗_性暗示_擦边描述_谐音',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 84,
    is_enabled: true,
    sort_order: 4,
  },
  // 色情低俗 > 露点 (point_id=80022) 补 3 条 → 6 总
  {
    id: 8002204,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_大腿内侧',
    label_cn: '色情低俗_露点_大腿内侧',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8002205,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_脚部',
    label_cn: '色情低俗_露点_脚部',
    low_threshold: 18,
    medium_threshold: 48,
    high_threshold: 80,
    is_enabled: true,
    sort_order: 5,
  },
  {
    id: 8002206,
    point_id: 80022,
    l1_label: '色情低俗',
    l2_label: '色情低俗_露点',
    l3_label: '色情低俗_露点_私处轮廓',
    label_cn: '色情低俗_露点_私处轮廓',
    low_threshold: 32,
    medium_threshold: 62,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 6,
  },
  // 色情低俗 > 低俗用语 (point_id=80023) 补 2 条 → 4 总
  {
    id: 8002303,
    point_id: 80023,
    l1_label: '色情低俗',
    l2_label: '色情低俗_低俗用语',
    l3_label: '色情低俗_低俗用语_性暗示',
    label_cn: '色情低俗_低俗用语_性暗示',
    low_threshold: 18,
    medium_threshold: 48,
    high_threshold: 82,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8002304,
    point_id: 80023,
    l1_label: '色情低俗',
    l2_label: '色情低俗_低俗用语',
    l3_label: '色情低俗_低俗用语_嘲讽',
    label_cn: '色情低俗_低俗用语_嘲讽',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 84,
    is_enabled: true,
    sort_order: 4,
  },
  // 广告法 > 虚假宣传 (point_id=80031) 补 3 条 → 6 总
  {
    id: 8003104,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_夸大投资回报',
    label_cn: '广告法_虚假宣传_夸大投资回报',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8003105,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_夸大减肥效果',
    label_cn: '广告法_虚假宣传_夸大减肥效果',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 84,
    is_enabled: true,
    sort_order: 5,
  },
  {
    id: 8003106,
    point_id: 80031,
    l1_label: '广告法',
    l2_label: '广告法_虚假宣传',
    l3_label: '广告法_虚假宣传_未批准功效',
    label_cn: '广告法_虚假宣传_未批准功效',
    low_threshold: 25,
    medium_threshold: 55,
    high_threshold: 88,
    is_enabled: true,
    sort_order: 6,
  },
  // 广告法 > 极限用语 (point_id=80032) 补 2 条 → 5 总
  {
    id: 8003204,
    point_id: 80032,
    l1_label: '广告法',
    l2_label: '广告法_极限用语',
    l3_label: '广告法_极限用语_权威',
    label_cn: '广告法_极限用语_权威',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 84,
    is_enabled: true,
    sort_order: 4,
  },
  {
    id: 8003205,
    point_id: 80032,
    l1_label: '广告法',
    l2_label: '广告法_极限用语',
    l3_label: '广告法_极限用语_全网最低',
    label_cn: '广告法_极限用语_全网最低',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 5,
  },
  // 未成年人 > 未成年人保护 (point_id=80041) 补 2 条 → 4 总
  {
    id: 8004103,
    point_id: 80041,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人保护',
    l3_label: '未成年人_未成年人保护_未成年人受虐_校园暴力',
    label_cn: '未成年人_未成年人保护_未成年人受虐_校园暴力',
    low_threshold: 32,
    medium_threshold: 62,
    high_threshold: 90,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8004104,
    point_id: 80041,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人保护',
    l3_label: '未成年人_未成年人保护_未成年人受虐_家庭暴力',
    label_cn: '未成年人_未成年人保护_未成年人受虐_家庭暴力',
    low_threshold: 35,
    medium_threshold: 65,
    high_threshold: 92,
    is_enabled: true,
    sort_order: 4,
  },
  // 未成年人 > 未成年人消费引导 (point_id=80042) 补 2 条 → 4 总
  {
    id: 8004203,
    point_id: 80042,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人消费引导',
    l3_label: '未成年人_未成年人消费引导_直播打赏',
    label_cn: '未成年人_未成年人消费引导_直播打赏',
    low_threshold: 22,
    medium_threshold: 52,
    high_threshold: 86,
    is_enabled: true,
    sort_order: 3,
  },
  {
    id: 8004204,
    point_id: 80042,
    l1_label: '未成年人',
    l2_label: '未成年人_未成年人消费引导',
    l3_label: '未成年人_未成年人消费引导_虚拟货币',
    label_cn: '未成年人_未成年人消费引导_虚拟货币',
    low_threshold: 20,
    medium_threshold: 50,
    high_threshold: 84,
    is_enabled: true,
    sort_order: 4,
  },
]

/**
 * 按 item.name_cn(L1 风险标签)预置的 sub-审核点列表 — 2026-07-30 新增
 *
 * 当后端 DB 返回的真实 AuditPoint.id 不在 MOCK_SUB_AUDIT_POINTS 的
 * 精确匹配列表里时(常见场景：后端真实数据 + 后端没建 sub_audit_points 表),
 * 按 item.name_cn 匹配这里预置的通用 sub 列表,保证每个真实父点
 * 也能展示多条 sub,而不是 fallback 单条。
 *
 * - key = AuditItem.name_cn (L1 标签: 涉政 / 暴恐 / 色情低俗 / 广告法 / 未成年人)
 * - value = 该 item 下所有父点共享的 sub 列表(命名 = `{父点名}_默认三级`)
 * - sub.id 为占位 id(运行时通过 pointId 派生,避免不同 point 共享同一 id)
 *
 * 仅前端 mock，不参与后端 schema / API。
 */
export const MOCK_SUB_AUDIT_POINTS_BY_ITEM: Record<string, Omit<MockSubAuditPoint, 'id' | 'point_id'>[]> = {
  涉政: [
    {
      l1_label: '涉政', l2_label: '现任国家主席', l3_label: '现任国家主席_默认三级',
      label_cn: '现任国家主席_默认三级', low_threshold: 20, medium_threshold: 60, high_threshold: 90, is_enabled: true, sort_order: 1,
    },
    {
      l1_label: '涉政', l2_label: '历任国家核心领导人', l3_label: '历任国家核心领导人_默认三级',
      label_cn: '历任国家核心领导人_默认三级', low_threshold: 15, medium_threshold: 50, high_threshold: 85, is_enabled: true, sort_order: 2,
    },
    {
      l1_label: '涉政', l2_label: '国内其他主要领导人', l3_label: '国内其他主要领导人_默认三级',
      label_cn: '国内其他主要领导人_默认三级', low_threshold: 18, medium_threshold: 52, high_threshold: 86, is_enabled: true, sort_order: 3,
    },
    {
      l1_label: '涉政', l2_label: '核心领导人不当表述', l3_label: '核心领导人不当表述_默认三级',
      label_cn: '核心领导人不当表述_默认三级', low_threshold: 22, medium_threshold: 55, high_threshold: 88, is_enabled: true, sort_order: 4,
    },
    {
      l1_label: '涉政', l2_label: '现任任国外领导人', l3_label: '现任任国外领导人_默认三级',
      label_cn: '现任任国外领导人_默认三级', low_threshold: 20, medium_threshold: 50, high_threshold: 85, is_enabled: true, sort_order: 5,
    },
    {
      l1_label: '涉政', l2_label: '主要政治禁言事件', l3_label: '主要政治禁言事件_默认三级',
      label_cn: '主要政治禁言事件_默认三级', low_threshold: 25, medium_threshold: 55, high_threshold: 88, is_enabled: true, sort_order: 6,
    },
  ],
  暴恐: [
    {
      l1_label: '暴恐', l2_label: '暴恐_暴力血腥', l3_label: '暴恐_暴力血腥_默认三级',
      label_cn: '暴恐_暴力血腥_默认三级', low_threshold: 25, medium_threshold: 55, high_threshold: 88, is_enabled: true, sort_order: 1,
    },
    {
      l1_label: '暴恐', l2_label: '暴恐_武器弹药', l3_label: '暴恐_武器弹药_默认三级',
      label_cn: '暴恐_武器弹药_默认三级', low_threshold: 30, medium_threshold: 60, high_threshold: 90, is_enabled: true, sort_order: 2,
    },
    {
      l1_label: '暴恐', l2_label: '暴恐_恐怖袭击', l3_label: '暴恐_恐怖袭击_默认三级',
      label_cn: '暴恐_恐怖袭击_默认三级', low_threshold: 35, medium_threshold: 65, high_threshold: 95, is_enabled: true, sort_order: 3,
    },
    {
      l1_label: '暴恐', l2_label: '暴恐_爆炸物', l3_label: '暴恐_爆炸物_默认三级',
      label_cn: '暴恐_爆炸物_默认三级', low_threshold: 35, medium_threshold: 65, high_threshold: 92, is_enabled: true, sort_order: 4,
    },
    {
      l1_label: '暴恐', l2_label: '暴恐_群体事件', l3_label: '暴恐_群体事件_默认三级',
      label_cn: '暴恐_群体事件_默认三级', low_threshold: 22, medium_threshold: 52, high_threshold: 86, is_enabled: true, sort_order: 5,
    },
  ],
  色情低俗: [
    {
      l1_label: '色情低俗', l2_label: '色情低俗_性暗示', l3_label: '色情低俗_性暗示_默认三级',
      label_cn: '色情低俗_性暗示_默认三级', low_threshold: 20, medium_threshold: 50, high_threshold: 85, is_enabled: true, sort_order: 1,
    },
    {
      l1_label: '色情低俗', l2_label: '色情低俗_露点', l3_label: '色情低俗_露点_默认三级',
      label_cn: '色情低俗_露点_默认三级', low_threshold: 30, medium_threshold: 60, high_threshold: 90, is_enabled: true, sort_order: 2,
    },
    {
      l1_label: '色情低俗', l2_label: '色情低俗_低俗用语', l3_label: '色情低俗_低俗用语_默认三级',
      label_cn: '色情低俗_低俗用语_默认三级', low_threshold: 15, medium_threshold: 45, high_threshold: 80, is_enabled: true, sort_order: 3,
    },
    {
      l1_label: '色情低俗', l2_label: '色情低俗_色情内容', l3_label: '色情低俗_色情内容_默认三级',
      label_cn: '色情低俗_色情内容_默认三级', low_threshold: 35, medium_threshold: 65, high_threshold: 92, is_enabled: true, sort_order: 4,
    },
    {
      l1_label: '色情低俗', l2_label: '色情低俗_未成年人相关', l3_label: '色情低俗_未成年人相关_默认三级',
      label_cn: '色情低俗_未成年人相关_默认三级', low_threshold: 38, medium_threshold: 68, high_threshold: 95, is_enabled: true, sort_order: 5,
    },
  ],
  广告法: [
    {
      l1_label: '广告法', l2_label: '广告法_虚假宣传', l3_label: '广告法_虚假宣传_默认三级',
      label_cn: '广告法_虚假宣传_默认三级', low_threshold: 20, medium_threshold: 50, high_threshold: 85, is_enabled: true, sort_order: 1,
    },
    {
      l1_label: '广告法', l2_label: '广告法_极限用语', l3_label: '广告法_极限用语_默认三级',
      label_cn: '广告法_极限用语_默认三级', low_threshold: 20, medium_threshold: 50, high_threshold: 85, is_enabled: true, sort_order: 2,
    },
    {
      l1_label: '广告法', l2_label: '广告法_医疗功效', l3_label: '广告法_医疗功效_默认三级',
      label_cn: '广告法_医疗功效_默认三级', low_threshold: 25, medium_threshold: 55, high_threshold: 88, is_enabled: true, sort_order: 3,
    },
    {
      l1_label: '广告法', l2_label: '广告法_绝对化用语', l3_label: '广告法_绝对化用语_默认三级',
      label_cn: '广告法_绝对化用语_默认三级', low_threshold: 22, medium_threshold: 52, high_threshold: 86, is_enabled: true, sort_order: 4,
    },
    {
      l1_label: '广告法', l2_label: '广告法_诱导消费', l3_label: '广告法_诱导消费_默认三级',
      label_cn: '广告法_诱导消费_默认三级', low_threshold: 18, medium_threshold: 48, high_threshold: 82, is_enabled: true, sort_order: 5,
    },
  ],
  未成年人: [
    {
      l1_label: '未成年人', l2_label: '未成年人_未成年人保护', l3_label: '未成年人_未成年人保护_默认三级',
      label_cn: '未成年人_未成年人保护_默认三级', low_threshold: 30, medium_threshold: 60, high_threshold: 90, is_enabled: true, sort_order: 1,
    },
    {
      l1_label: '未成年人', l2_label: '未成年人_未成年人消费引导', l3_label: '未成年人_未成年人消费引导_默认三级',
      label_cn: '未成年人_未成年人消费引导_默认三级', low_threshold: 25, medium_threshold: 55, high_threshold: 88, is_enabled: true, sort_order: 2,
    },
    {
      l1_label: '未成年人', l2_label: '未成年人_校园暴力', l3_label: '未成年人_校园暴力_默认三级',
      label_cn: '未成年人_校园暴力_默认三级', low_threshold: 32, medium_threshold: 62, high_threshold: 90, is_enabled: true, sort_order: 3,
    },
    {
      l1_label: '未成年人', l2_label: '未成年人_沉迷网络', l3_label: '未成年人_沉迷网络_默认三级',
      label_cn: '未成年人_沉迷网络_默认三级', low_threshold: 22, medium_threshold: 52, high_threshold: 86, is_enabled: true, sort_order: 4,
    },
    {
      l1_label: '未成年人', l2_label: '未成年人_不当内容接触', l3_label: '未成年人_不当内容接触_默认三级',
      label_cn: '未成年人_不当内容接触_默认三级', low_threshold: 35, medium_threshold: 65, high_threshold: 92, is_enabled: true, sort_order: 5,
    },
  ],
}

/**
 * 为指定审核点兜底派生 sub-审核点列表 — 2026-07-30 重构
 *
 * 业务规则: 风险标签体系要求「一级 / 二级 / 三级」三级结构。
 * 默认每个二级审核点都应挂载至少一个三级细分标签。
 *
 * 匹配优先级:
 * 1. 精确匹配 `point_id` → MOCK_SUB_AUDIT_POINTS(覆盖 mock 区间 80001-80042)
 * 2. 按 `itemNameCn`(L1 风险标签)匹配 → MOCK_SUB_AUDIT_POINTS_BY_ITEM
 *    (覆盖真实 DB 返回的 AuditPoint,共享该 item 下的通用 sub 列表)
 * 3. 兜底:派生 1 条「{itemNameCn}_默认三级」
 *
 * sub.id 在运行时通过 pointId * 1000 + sort_order 派生,避免不同 point 共享同一 id。
 *
 * 仅前端 mock，不参与后端 schema / API。
 */
export function getMockSubAuditPoints(
  pointId: number,
  itemNameCn?: string,
): MockSubAuditPoint[] {
  const configured = MOCK_SUB_AUDIT_POINTS.filter((s) => s.point_id === pointId)
    .sort((a, b) => a.sort_order - b.sort_order)
  if (configured.length > 0) return configured

  if (itemNameCn && MOCK_SUB_AUDIT_POINTS_BY_ITEM[itemNameCn]) {
    return MOCK_SUB_AUDIT_POINTS_BY_ITEM[itemNameCn].map((s) => ({
      ...s,
      id: pointId * 1000 + s.sort_order,
      point_id: pointId,
    }))
  }

  const l2 = itemNameCn ?? `未命名审核点 ${pointId}`
  return [
    {
      id: pointId * 100 + 99,
      point_id: pointId,
      l1_label: '默认',
      l2_label: l2,
      l3_label: `${l2}_默认三级`,
      label_cn: `${l2}_默认三级`,
      low_threshold: 20,
      medium_threshold: 50,
      high_threshold: 85,
      is_enabled: true,
      sort_order: 1,
    },
  ]
}