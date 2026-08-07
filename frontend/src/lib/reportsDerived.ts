import type {
  RiskLevel,
  RiskTimeseriesPoint,
  RiskDistributionBucket,
  TopRiskLabelItem,
  TagDomain,
  TrendPoint,
} from '@/types/domain'

/** 汇总 risk 时序点中各等级 count */
export function sumRiskLevels(points: RiskTimeseriesPoint[]): {
  high: number
  medium: number
  low: number
  sensitive: number
  none: number
  total: number
} {
  return points.reduce(
    (acc, p) => {
      acc.high += p.high
      acc.medium += p.medium
      acc.low += p.low
      acc.sensitive += p.sensitive
      acc.none += p.none
      acc.total += p.total
      return acc
    },
    { high: 0, medium: 0, low: 0, sensitive: 0, none: 0, total: 0 },
  )
}

/** 趋势点按小时桶聚合 (保留接口, 当前 RiskProfileTab 未使用) */
export function bucketByHour(
  series: TrendPoint[],
): { hour: number; value: number }[] {
  const buckets = new Array<number>(24).fill(0)
  for (const p of series) {
    const hour = Number(p.bucket.slice(11, 13))
    if (!Number.isNaN(hour) && hour >= 0 && hour < 24) {
      buckets[hour] += p.value
    }
  }
  return buckets.map((value, hour) => ({ hour, value }))
}

export function isWeekend(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

type RiskField = 'high' | 'medium' | 'low' | 'sensitive' | 'none'

const RISK_FIELD: Record<RiskLevel, RiskField> = {
  高风险: 'high',
  中风险: 'medium',
  低风险: 'low',
  敏感: 'sensitive',
  无风险: 'none',
}

/** 按所选 risk_levels 过滤 trend 时序; 取消的等级置 0, total 同步重算 */
export function filterRiskTimeseries(
  points: RiskTimeseriesPoint[],
  selected: RiskLevel[],
): RiskTimeseriesPoint[] {
  const allowed = new Set(selected)
  return points.map((p) => {
    const next: RiskTimeseriesPoint = { ...p, total: 0 }
    let total = 0
    for (const level of Object.keys(RISK_FIELD) as RiskLevel[]) {
      const field = RISK_FIELD[level]
      const v = p[field]
      if (allowed.has(level)) {
        next[field] = v
        total += v
      } else {
        next[field] = 0
      }
    }
    next.total = total
    return next
  })
}

/** 按所选 risk_levels 过滤 distribution buckets */
export function filterRiskDistribution(
  buckets: RiskDistributionBucket[],
  selected: RiskLevel[],
): RiskDistributionBucket[] {
  const allowed = new Set(selected)
  return buckets.filter((b) => allowed.has(b.level))
}

/**
 * 按所选审核项分类(后端 TagDomain) 过滤 Top 命中审核点
 * 匹配规则: r.label 字符串包含 domain 关键词 (宽松匹配)
 * 透传策略: 至少 1 个 selected, 但 0 匹配时原样返回避免漏数据
 */
export function filterTopAuditPointsByDomain(
  items: TopRiskLabelItem[],
  selected: TagDomain[],
): TopRiskLabelItem[] {
  if (selected.length === 0) return []
  const keywords = new Set(selected)
  const matched = items.filter((it) => {
    for (const k of keywords) {
      if (it.label.toLowerCase().includes(k.toLowerCase())) return true
    }
    return false
  })
  return matched.length > 0 ? matched : items
}

/**
 * 业务口径修正: "敏感"档仅承载 PII (身份证/手机号/银行卡等), 与违规互斥.
 * 后端 top-labels 聚合偶尔会返回 "涉政敏感" / "暴恐敏感" 等合成词,
 * 这些应归到"高/中风险"档 (由后端去重逻辑承担), 不应在"敏感 PII"里出现.
 *
 * 本函数前端兜底: 剔除"敏感"档里命中违规关键词的项, 让其退回原档.
 */
const PII_FORBIDDEN_KEYWORDS = [
  '涉政',
  '暴恐',
  '涉暴',
  '涉黄',
  '色情',
  '医疗',
  '医药',
  '金融',
  '赌博',
  '欺诈',
  '广告法',
  '未成年',
  '政治',
  '领导人',
  '国旗',
  '国徽',
  '人民币',
]

export function stripViolationTermsFromSensitive(
  items: TopRiskLabelItem[],
): TopRiskLabelItem[] {
  return items.filter((it) => {
    if (it.risk_level !== '敏感') return true
    const label = it.label
    return !PII_FORBIDDEN_KEYWORDS.some((kw) => label.includes(kw))
  })
}
