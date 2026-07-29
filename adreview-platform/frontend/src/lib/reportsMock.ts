/**
 * 审核结果数据报表 — 趋势/异常 前端 mock 数据
 * --------------------------------------------------------------
 * 用于 /reports 页面（趋势分析 + 异常分析）演示模式。
 *
 * 设计原则：
 * 1. 与 riskPointMock.ts 一致：仅前端 mock，不动后端 schema；
 * 2. 数据按 [start, end] 窗口生成，bucket 粒度自适应；
 * 3. 用确定性随机（seedable PRNG）保证「重新生成」按钮可控；
 * 4. 字段严格对齐 backend app.schemas.analytics，避免 TS 报错。
 */
import type {
  AlertEventOut,
  AnomalyAlertSummary,
  AnomalyCurrent,
  AnomalyMetricPoint,
  AnomalyResponse,
  MaterialType,
  RiskTimeseriesPoint,
  RiskTrendOptionsResponse,
} from '@/types/domain'
import type { DetectionModality } from '@/types/domain'

export interface MockSeed {
  /** PRNG seed — 重新生成数据时由 ReportsPage 注入新值 */
  seed: number
  /** 窗口起点 (ms) */
  start: number
  /** 窗口终点 (ms) */
  end: number
  /** bucket 粒度: 'hour' | 'day' | '5min' */
  granularity: '5min' | 'hour' | 'day'
  /** 媒体/素材类型 filters (取并集，与后端 combinedMaterialTypes 一致) */
  materialTypes?: string[]
}

// ---------------------------------------------------------------------------
// PRNG — 简单可重复的 mulberry32
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// 时间桶
// ---------------------------------------------------------------------------

interface TimeBucket {
  /** bucket 起始 UTC ms */
  startMs: number
  /** bucket 大小 (ms) */
  sizeMs: number
  /** bucket key — 后端 ISO 格式 'YYYY-MM-DDTHH:mm:ss' */
  key: string
}

export function pickGranularity(spanMs: number): '5min' | 'hour' | 'day' {
  // 1h -> 5min (12 桶); 24h -> hour (24 桶); >= 3d -> day
  const oneHour = 60 * 60 * 1000
  const threeDays = 3 * 24 * oneHour
  if (spanMs <= 2 * oneHour) return '5min'
  if (spanMs < threeDays) return 'hour'
  return 'day'
}

function buildBuckets(
  startMs: number,
  endMs: number,
  granularity: '5min' | 'hour' | 'day' | 'month',
): TimeBucket[] {
  const buckets: TimeBucket[] = []
  let cur = startMs
  const advance = (current: number): number => {
    if (granularity === 'month') {
      const d = new Date(current)
      return new Date(Date.UTC(
        d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(),
        (d.getUTCMonth() + 1) % 12,
        1,
      )).getTime()
    }
    const sizeMs =
      granularity === '5min'
        ? 5 * 60 * 1000
        : granularity === 'hour'
          ? 60 * 60 * 1000
          : 24 * 60 * 60 * 1000
    return current + sizeMs
  }
  let floor = startMs
  if (granularity === 'month') {
    const d = new Date(startMs)
    floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  } else {
    const d = new Date(startMs)
    const hour = granularity === 'day' ? 0 : d.getUTCHours()
    const min = granularity === '5min' ? Math.floor(d.getUTCMinutes() / 5) * 5 : 0
    floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, min)
  }
  cur = floor
  while (cur < endMs) {
    const d = new Date(cur)
    let key: string
    if (granularity === 'month') {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00`
    } else if (granularity === 'day') {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00`
    } else if (granularity === 'hour') {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00:00`
    } else {
      const baseMin = Math.floor(d.getUTCMinutes() / 5) * 5
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(baseMin).padStart(2, '0')}:00`
    }
    const sizeMs = granularity === 'month' ? 30 * 24 * 60 * 60 * 1000 : (granularity === 'day' ? 24 * 60 * 60 * 1000 : granularity === 'hour' ? 60 * 60 * 1000 : 5 * 60 * 1000)
    buckets.push({ startMs: cur, sizeMs, key })
    cur = advance(cur)
  }
  return buckets
}

// ---------------------------------------------------------------------------
// 风险趋势 (TrendTab) — 4 级 vs 5 级两套
// ---------------------------------------------------------------------------

const EMPTY_4 = { none: 0, low: 0, medium: 0, high: 0 }

export function buildRiskTrend(opts: {
  days: number
  /** 是否含媒体/素材过滤 — 影响总数波动 */
  filtered?: boolean
  filterSeed?: string
  mockSeed?: number
  /** 颗粒度: hour/day/month. 缺省按窗口长度自动估算. */
  granularity?: 'hour' | 'day' | 'month'
}): RiskTimeseriesPoint[] {
  const now = Date.now()
  const start = now - opts.days * 24 * 60 * 60 * 1000
  const granularity: 'hour' | 'day' | 'month' =
    opts.granularity ?? (opts.days <= 2 ? 'hour' : opts.days <= 31 ? 'day' : 'month')
  const buckets = buildBuckets(start, now, granularity)
  const prng = mulberry32((opts.mockSeed ?? 0xa1b2c3d4) ^ hashString(`riskTrend|${opts.days}|${granularity}|${opts.filtered ? opts.filterSeed ?? '' : ''}`))

  return buckets.map((b, idx) => {
    // 周末 (周六=6, 周日=0 in JS) 提交量更高; 工作日波动
    const dow = new Date(b.startMs).getUTCDay()
    const weekendBoost = dow === 0 || dow === 6 ? 1.25 : 1.0
    const baseTotal = Math.round(2200 * weekendBoost + (prng() - 0.5) * 800)
    // 4 级分布: high 显式 1.5%~3%, 其余在 none/low/medium 间按比例分, 避免 high 因四舍五入落到 0
    const highPct = 0.015 + prng() * 0.015
    const mediumPct = 0.06 + prng() * 0.02
    const lowPct = 0.14 + prng() * 0.03
    const high = Math.max(1, Math.round(baseTotal * highPct))
    const medium = Math.max(1, Math.round(baseTotal * mediumPct))
    const low = Math.max(1, Math.round(baseTotal * lowPct))
    const none = Math.max(0, baseTotal - high - medium - low)
    void EMPTY_4
    void idx
    const denominator = high + medium + low + none
    return {
      bucket: b.key,
      total: denominator,
      denominator,
      high,
      medium,
      low,
      // 让数据形状兼容 5-level enum (sensitive/none); TrendTab 只读 high/medium/low/none
      sensitive: 0,
      none,
    }
  })
}

export function buildRiskTrendOptions(seed: number): RiskTrendOptionsResponse {
  const prng = mulberry32(seed ^ 0xfeed_face)
  const pick = (n: number, alphabet: string) =>
    Array.from({ length: n }, () => alphabet[Math.floor(prng() * alphabet.length)]).join('')
  return {
    modalities: [
      { value: 'image', label: '图片' },
      { value: 'text', label: '文本' },
      { value: 'video', label: '视频' },
      { value: 'audio', label: '语音' },
      { value: 'document', label: '文档' },
    ],
    strategies: [
      { value: 'default', label: '默认策略' },
      { value: 'medical-strict', label: '医药严格策略' },
      { value: 'finance-strict', label: '金融严格策略' },
    ],
    channels: [
      { value: '模型输入', label: '模型输入' },
      { value: '模型输出', label: '模型输出' },
      { value: '小红书', label: '小红书' },
      { value: '电商', label: '电商' },
    ],
    account_ids: [
      { value: `acc-${pick(4, '0123456789')}`, label: `acc-${pick(4, '0123456789')}` },
      { value: `acc-${pick(4, '0123456789')}`, label: `acc-${pick(4, '0123456789')}` },
    ],
    ips: [
      { value: '10.0.0.1', label: '10.0.0.1' },
      { value: '10.0.0.2', label: '10.0.0.2' },
      { value: '192.168.1.10', label: '192.168.1.10' },
    ],
    risk_taxonomy: [
      {
        code: 'politics',
        label: '涉政',
        path: 'politics',
        children: [
          {
            code: 'politics/sensitive_term',
            label: '敏感词',
            path: 'politics/sensitive_term',
            children: [
              { code: 'politics/sensitive_term/leader', label: '领导人', path: 'politics/sensitive_term/leader' },
              { code: 'politics/sensitive_term/event', label: '敏感事件', path: 'politics/sensitive_term/event' },
            ],
          },
        ],
      },
      {
        code: 'porn',
        label: '涉黄',
        path: 'porn',
        children: [
          {
            code: 'porn/figure',
            label: '人物',
            path: 'porn/figure',
            children: [
              { code: 'porn/figure/explicit', label: '明显色情', path: 'porn/figure/explicit' },
            ],
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// AnomalyTab — 实时指标 + 报警事件
// ---------------------------------------------------------------------------

const RULE_LABEL: Record<string, string> = {
  reject_rate_high: '拒绝率异常',
  high_risk_content_high: '高风险内容异常',
  high_risk_account_concentration: '高风险账号聚集',
  reject_rate_spike: '拒绝率突升',
  high_risk_concentration: '高风险账号聚集',
  submit_drop: '提交量骤降',
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  warn: 'orange',
  info: 'blue',
}

export function buildAnomalyResponse(opts: {
  startMs: number
  endMs: number
  granularity: '5min' | 'hour' | 'day'
  mockSeed?: number
  filterSeed?: string
  filtered?: boolean
}): AnomalyResponse {
  const buckets = buildBuckets(opts.startMs, opts.endMs, opts.granularity)
  const filterHash = opts.filterSeed ? hashString(opts.filterSeed) : 0
  const prng = mulberry32(
    (opts.mockSeed ?? 0xb1c2d3e4) ^ hashString(`anomaly|${opts.startMs}|${opts.endMs}`) ^ filterHash,
  )

  const series: AnomalyMetricPoint[] = buckets.map((b) => {
    // 拒绝率基线 12-22%, 偶发突跳到 30+% 制造告警
    const spike = prng() < 0.08
    const reject = spike ? 25 + prng() * 12 : 12 + prng() * 8
    const review = 18 + prng() * 10
    const approve = Math.max(0, 100 - reject - review)
    const submitted = Math.round(120 + prng() * 180)
    return {
      bucket: b.key,
      reject_rate: Number(reject.toFixed(2)),
      review_rate: Number(review.toFixed(2)),
      approve_rate: Number(approve.toFixed(2)),
      submitted,
    }
  })

  const last = series[series.length - 1] ?? {
    bucket: new Date(opts.endMs).toISOString().slice(0, 19),
    reject_rate: 0,
    review_rate: 0,
    approve_rate: 0,
    submitted: 0,
  }

  const current: AnomalyCurrent = {
    bucket: last.bucket,
    reject_rate: last.reject_rate,
    review_rate: last.review_rate,
    approve_rate: last.approve_rate,
    submitted: last.submitted,
    rejected: Math.round((last.submitted * last.reject_rate) / 100),
    high_risk_accounts: 12 + Math.floor(prng() * 18),
    high_risk_content_count: 30 + Math.floor(prng() * 40),
  }

  // 报警事件 — 由 series 里的 spike 派生 + 一些「always-on」构造
  const alerts: AnomalyAlertSummary[] = []
  let id = 900001
  const lastIdx = series.length - 1
  for (let i = 0; i < series.length; i++) {
    const p = series[i]
    const isRecent = lastIdx - i < 12
    if (p.reject_rate > 26 && isRecent) {
      alerts.push(buildAnomalyAlert(id++, 'reject_rate_high', p.bucket, buckets[i].sizeMs, p.reject_rate, 30, 'warn', 'open', opts.mockSeed))
    }
    if (i % 4 === 0 && isRecent) {
      const count = 35 + Math.floor(prng() * 30)
      alerts.push(buildAnomalyAlert(id++, 'high_risk_content_high', p.bucket, buckets[i].sizeMs, count, 50, 'warn', i % 7 === 0 ? 'acknowledged' : 'open', opts.mockSeed))
    }
    if (i % 5 === 0 && isRecent) {
      const count = 14 + Math.floor(prng() * 10)
      alerts.push(buildAnomalyAlert(id++, 'high_risk_account_concentration', p.bucket, buckets[i].sizeMs, count, 20, 'critical', i % 9 === 0 ? 'acknowledged' : 'open', opts.mockSeed))
    }
  }

  // 确保至少有 6 条且按时间倒序
  alerts.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  void SEVERITY_COLOR

  const exposedGranularity: 'hour' | 'day' = opts.granularity === '5min' ? 'hour' : opts.granularity
  return {
    window: bucketLabel(opts.granularity),
    granularity: exposedGranularity,
    window_start: new Date(opts.startMs).toISOString(),
    window_end: new Date(opts.endMs).toISOString(),
    applied: {
      modalities: [],
      strategy_codes: [],
      channels: [],
      account_ids: [],
      ips: [],
      risk_label_paths: [],
    },
    current,
    series,
    alerts,
  }
}

function buildAnomalyAlert(
  id: number,
  ruleCode: string,
  bucketKey: string,
  sizeMs: number,
  observed: number,
  threshold: number,
  severity: 'critical' | 'warn' | 'info',
  status: 'open' | 'acknowledged',
  mockSeed?: number,
): AnomalyAlertSummary {
  const startMs = Date.parse(bucketKey)
  const endMs = startMs + sizeMs
  const detailStr = JSON.stringify({
    rule_code: ruleCode,
    seed: mockSeed,
    generator: 'reportsMock',
  })
  return {
    id,
    public_id: `mock-${id}`,
    rule_code: ruleCode,
    severity,
    metric: RULE_LABEL[ruleCode] ?? ruleCode,
    window_start: new Date(startMs).toISOString(),
    window_end: new Date(endMs).toISOString(),
    observed_value: observed,
    threshold,
    status,
    created_at: new Date(startMs + 30_000).toISOString(),
    detail: { generated: detailStr },
  }
}

function bucketLabel(g: '5min' | 'hour' | 'day'): string {
  return g === '5min' ? '5min' : g === 'hour' ? 'hour' : 'day'
}

// ---------------------------------------------------------------------------
// 报警列表（alertsApi.list）— 复用上面的 alert 池，但按 status 过滤
// ---------------------------------------------------------------------------

const _alertPool: Record<number, AlertEventOut[]> = {}

export function getMockAlerts(opts: {
  status: 'open' | 'acknowledged' | 'all'
  limit: number
  mockSeed?: number
  filterSeed?: string
  filtered?: boolean
}): AlertEventOut[] {
  const seed = opts.mockSeed ?? 0xc1d2e3f4
  let pool = _alertPool[seed]
  if (!pool) {
    const compact = buildAnomalyResponse({
      startMs: Date.now() - 24 * 60 * 60 * 1000,
      endMs: Date.now(),
      granularity: 'hour',
      mockSeed: seed,
    }).alerts
    const base: AlertEventOut[] = compact.map((c) => expandToAlertEventOut(c))
    // 同一段时间基础上追加更多历史事件
    const extra: AlertEventOut[] = []
    const prng = mulberry32(seed ^ 0x12345)
    const ruleCodes = ['reject_rate_high', 'high_risk_content_high', 'high_risk_account_concentration'] as const
    for (let i = 0; i < 30; i++) {
      const code = ruleCodes[Math.floor(prng() * 3)]
      const hoursAgo = 1 + Math.floor(prng() * 23)
      const startMs = Date.now() - hoursAgo * 60 * 60 * 1000
      const observed =
        code === 'reject_rate_high' ? 30 + prng() * 15 : code === 'high_risk_content_high' ? 55 + prng() * 40 : 22 + prng() * 12
      const threshold = code === 'reject_rate_high' ? 30 : code === 'high_risk_content_high' ? 50 : 20
      const severity = code === 'high_risk_account_concentration' ? 'critical' : 'warn'
      const status: 'open' | 'acknowledged' = prng() < 0.55 ? 'open' : 'acknowledged'
      extra.push(
        buildFullAlert(
          800000 + i,
          code,
          new Date(startMs).toISOString(),
          observed,
          threshold,
          severity,
          status,
          seed,
        ),
      )
    }
    pool = [...base, ...extra].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    _alertPool[seed] = pool
  }
  const filtered = opts.status === 'all' ? pool : pool.filter((a) => a.status === opts.status)
  return filtered.slice(0, opts.limit)
}

function expandToAlertEventOut(c: AnomalyAlertSummary): AlertEventOut {
  return {
    id: c.id,
    public_id: c.public_id,
    rule_code: c.rule_code,
    severity: c.severity,
    metric: c.metric,
    window_start: c.window_start,
    window_end: c.window_end,
    observed_value: c.observed_value,
    threshold: c.threshold,
    dimension: {},
    detail: c.detail,
    status: c.status as 'open' | 'acknowledged',
    ack_by: c.status === 'acknowledged' ? 1 : null,
    ack_at: c.status === 'acknowledged' ? new Date(Date.parse(c.created_at) + 60_000).toISOString() : null,
    ack_note: c.status === 'acknowledged' ? '已确认并通知值班' : null,
    notified: true,
    created_at: c.created_at,
  }
}

function buildFullAlert(
  id: number,
  ruleCode: string,
  windowStart: string,
  observed: number,
  threshold: number,
  severity: 'critical' | 'warn' | 'info',
  status: 'open' | 'acknowledged',
  mockSeed?: number,
): AlertEventOut {
  const startMs = Date.parse(windowStart)
  void mockSeed
  return {
    id,
    public_id: `mock-${id}`,
    rule_code: ruleCode,
    severity,
    metric: RULE_LABEL[ruleCode] ?? ruleCode,
    window_start: new Date(startMs).toISOString(),
    window_end: new Date(startMs + 60 * 60 * 1000).toISOString(),
    observed_value: observed,
    threshold,
    dimension: {},
    detail: { generated: 'reportsMock' },
    status,
    ack_by: status === 'acknowledged' ? 1 : null,
    ack_at: status === 'acknowledged' ? new Date(startMs + 60_000).toISOString() : null,
    ack_note: status === 'acknowledged' ? '已确认并通知值班' : null,
    notified: true,
    created_at: new Date(startMs + 30_000).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Trends Tab 旧 API 兼容 — 提供 TrendPoint（/reports/trend）
// ---------------------------------------------------------------------------

export function buildTrend(metric: 'reject_rate' | 'review_rate' | 'approve_rate' | 'submitted', days: number, mockSeed?: number): {
  metric: string
  granularity: 'day'
  window_start: string
  window_end: string
  points: Array<{ bucket: string; value: number; sample_count: number }>
  delta_pct: number | null
} {
  const prng = mulberry32((mockSeed ?? 0xd1e2f3) ^ hashString(`trend|${metric}|${days}`))
  const buckets: Array<{ bucket: string; value: number; sample_count: number }> = []
  const now = Date.now()
  let sum = 0
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00`
    let value: number
    if (metric === 'submitted') {
      value = Math.round(2200 + (prng() - 0.4) * 1000)
    } else if (metric === 'reject_rate') {
      value = Number((14 + (prng() - 0.5) * 8).toFixed(2))
    } else if (metric === 'review_rate') {
      value = Number((22 + (prng() - 0.5) * 6).toFixed(2))
    } else {
      value = Number((64 + (prng() - 0.5) * 6).toFixed(2))
    }
    const sample_count = Math.round(2200 + prng() * 400)
    sum += value
    buckets.push({ bucket: key, value, sample_count })
  }
  const first = buckets[0]?.value ?? 0
  const last = buckets[buckets.length - 1]?.value ?? 0
  const delta = first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : null
  void sum
  return {
    metric,
    granularity: 'day',
    window_start: buckets[0]?.bucket ?? new Date(now - days * 86400_000).toISOString(),
    window_end: buckets[buckets.length - 1]?.bucket ?? new Date(now).toISOString(),
    points: buckets,
    delta_pct: delta,
  }
}

// ---------------------------------------------------------------------------
// 类型守卫 — 公共导出
// ---------------------------------------------------------------------------

export const __testing = {
  mulberry32,
  hashString,
  buildBuckets,
  pickGranularity,
  RULE_LABEL,
}

/** 防止 unused import 报错 */
export type _FilterParams = MaterialType[] | DetectionModality[]
