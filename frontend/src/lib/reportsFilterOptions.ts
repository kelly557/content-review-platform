import type {
  MaterialType,
  RiskLevel,
  TagDomain,
  MachineDecision,
} from '@/types/domain'

export const MATERIAL_TYPE_OPTIONS: { value: MaterialType; label: string }[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'pdf', label: '文件/PDF' },
  { value: 'text', label: '文本' },
]

export const RISK_LEVEL_OPTIONS: { value: RiskLevel; label: string; color: string; hint?: string }[] = [
  { value: '高风险', label: '高风险', color: '#DC2626', hint: '涉政/暴恐/医疗违规等' },
  { value: '中风险', label: '中风险', color: '#D97706', hint: '广告法/金融违规等' },
  { value: '低风险', label: '低风险', color: '#2563EB', hint: '需关注但通常可放行' },
  { value: '敏感', label: '敏感 (PII)', color: '#7C3AED', hint: 'PII 数据: 身份证/手机号/银行卡等' },
  { value: '无风险', label: '无风险', color: '#94A3B8' },
]

export const QUALITY_VERDICT_OPTIONS: {
  value: 'all' | 'misjudge' | 'miss' | 'agree'
  label: string
  color?: string
}[] = [
  { value: 'all', label: '全部' },
  { value: 'misjudge', label: '误判(机器漏放)', color: 'red' },
  { value: 'miss', label: '漏判(机器误杀)', color: 'orange' },
  { value: 'agree', label: '机人一致', color: 'green' },
]

export const MACHINE_DECISION_OPTIONS: { value: MachineDecision | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'block', label: '阻断' },
  { value: 'review', label: '复核' },
  { value: 'pass', label: '通过' },
]

/**
 * 业务别名: 审核项一级分类 = 后端 TagDomain 枚举
 * UI 展示时使用"审核项分类"措辞, 与 AuditItem / AuditPoint 业务实体保持一致
 */
export type AuditPointDomain = TagDomain

export const AUDIT_POINT_DOMAIN_OPTIONS: { value: AuditPointDomain; label: string }[] = [
  { value: 'politics', label: '涉政' },
  { value: 'porn', label: '涉黄' },
  { value: 'violence', label: '涉暴' },
  { value: 'ads_law', label: '广告法' },
  { value: 'medical', label: '医药' },
  { value: 'finance', label: '金融' },
  { value: 'minor', label: '未成年人' },
  { value: 'privacy', label: '隐私' },
  { value: 'ip', label: '知识产权' },
  { value: 'gambling', label: '赌博' },
  { value: 'fraud', label: '欺诈' },
  { value: 'custom', label: '自定义' },
]

/** 底层保留 TAG_DOMAIN_OPTIONS 以便后端字段直接使用 (与 AUDIT_POINT_DOMAIN_OPTIONS 等价) */
export const TAG_DOMAIN_OPTIONS = AUDIT_POINT_DOMAIN_OPTIONS

export const ALL_RISK_LEVELS: RiskLevel[] = RISK_LEVEL_OPTIONS.map((o) => o.value)
export const ALL_AUDIT_POINT_DOMAINS: AuditPointDomain[] =
  AUDIT_POINT_DOMAIN_OPTIONS.map((o) => o.value)
