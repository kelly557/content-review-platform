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