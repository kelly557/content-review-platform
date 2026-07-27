import { api } from './client'
import type {
  AlertEventOut,
  AlertPage,
  AnomalyResponse,
  OverviewStats,
  QualityResponse,
  RiskDistributionBucket,
  RiskTimeseriesPoint,
  TopRiskLabelItem,
  TrendMetric,
  TrendResponse,
} from '@/types/domain'
import {
  buildAnomalyResponse,
  buildRiskTrend,
  buildTrend,
  getMockAlerts,
  pickGranularity,
} from '@/lib/reportsMock'

export interface RiskTrendResponse {
  days: number
  points: RiskTimeseriesPoint[]
}

export interface RiskDistributionResponse {
  days: number
  buckets: RiskDistributionBucket[]
}

export interface TopRiskLabelsResponse {
  days: number
  items: TopRiskLabelItem[]
}

export interface WindowOpts {
  /** Shorthand window: ``today`` / ``7d`` / ``30d``. Ignored if ``start``+``end`` provided. */
  window?: string
  /** ISO 8601. Pair with ``end`` to override the shorthand window. */
  start?: string
  /** ISO 8601. Pair with ``start`` to override the shorthand window. */
  end?: string
}

/**
 * 演示数据 hook，由 useMockReports 提供。
 * ReportsPage 注入到所有 reportsApi / alertsApi 调用上。
 */
export interface MockMode {
  enabled: boolean
  seed: number
}

function resolveWindowBounds(opts: WindowOpts | string): { startMs: number; endMs: number; granularity: '5min' | 'hour' | 'day' } {
  const o: WindowOpts = typeof opts === 'string' ? { window: opts } : opts
  const endMs = o.end ? Date.parse(o.end) : Date.now()
  if (o.start && o.end) {
    const startMs = Date.parse(o.start)
    return { startMs, endMs, granularity: pickGranularity(endMs - startMs) }
  }
  const w = o.window ?? '7d'
  if (w === '1h') {
    return { startMs: endMs - 60 * 60 * 1000, endMs, granularity: '5min' }
  }
  if (w === '24h') {
    return { startMs: endMs - 24 * 60 * 60 * 1000, endMs, granularity: 'hour' }
  }
  if (w === 'today') {
    const d = new Date(endMs)
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    return { startMs: start, endMs, granularity: 'hour' }
  }
  const days = w === '30d' ? 30 : 7
  return { startMs: endMs - days * 24 * 60 * 60 * 1000, endMs, granularity: 'day' }
}

export const reportsApi = {
  overview(opts: WindowOpts | string = '7d', mock?: MockMode) {
    if (mock?.enabled) {
      const o: WindowOpts = typeof opts === 'string' ? { window: opts } : opts
      const w = o.window ?? '7d'
      const days = w === 'today' ? 1 : w === '30d' ? 30 : 7
      const points = buildRiskTrend({ days, mockSeed: mock.seed })
      const total = points.reduce((s, p) => s + p.total, 0)
      const high = points.reduce((s, p) => s + p.high, 0)
      const medium = points.reduce((s, p) => s + p.medium, 0)
      const submitted = Math.round(total * 1.2)
      const approved = total - high - medium
      const rejected = high + medium
      const in_review = Math.round(submitted * 0.18)
      return Promise.resolve({
        total_materials: total,
        in_review,
        approved,
        rejected,
        submitted,
        avg_review_hours: 1.6,
        reject_rate: submitted > 0 ? Number(((rejected / submitted) * 100).toFixed(2)) : 0,
        review_rate: 22.0,
        approve_rate: Number(((approved / submitted) * 100).toFixed(2)),
      } satisfies OverviewStats)
    }
    const o: WindowOpts = typeof opts === 'string' ? { window: opts } : opts
    const params: Record<string, string> = {}
    if (o.start && o.end) {
      params.start = o.start
      params.end = o.end
    } else {
      params.window = o.window ?? '7d'
    }
    return api.get<OverviewStats>('/reports/overview', { params }).then((r) => r.data)
  },
  trend(
    opts: {
      metric?: TrendMetric
      window?: string
      granularity?: string
      start?: string
      end?: string
    } = {},
    mock?: MockMode,
  ) {
    if (mock?.enabled) {
      const metric = opts.metric ?? 'reject_rate'
      const w = opts.window ?? '7d'
      const days = w === 'today' ? 1 : w === '30d' ? 30 : 7
      return Promise.resolve(buildTrend(metric, days, mock.seed) as TrendResponse)
    }
    const params: Record<string, string> = {}
    params.metric = opts.metric ?? 'reject_rate'
    if (opts.start && opts.end) {
      params.start = opts.start
      params.end = opts.end
    } else {
      params.window = opts.window ?? '7d'
    }
    if (opts.granularity) params.granularity = opts.granularity
    return api.get<TrendResponse>('/reports/trend', { params }).then((r) => r.data)
  },
  anomaly(opts: WindowOpts | string = '1h', mock?: MockMode) {
    if (mock?.enabled) {
      const { startMs, endMs, granularity } = resolveWindowBounds(opts)
      return Promise.resolve(
        buildAnomalyResponse({ startMs, endMs, granularity, mockSeed: mock.seed }),
      )
    }
    const o: WindowOpts = typeof opts === 'string' ? { window: opts } : opts
    const params: Record<string, string> = {}
    if (o.start && o.end) {
      params.start = o.start
      params.end = o.end
    } else {
      params.window = o.window ?? '1h'
    }
    return api
      .get<AnomalyResponse>('/reports/anomaly', { params })
      .then((r) => r.data)
  },
  quality(opts: { window?: string; strategy_code?: string; limit?: number } = {}) {
    return api
      .get<QualityResponse>('/reports/quality', {
        params: {
          window: opts.window ?? '7d',
          strategy_code: opts.strategy_code,
          limit: opts.limit ?? 200,
        },
      })
      .then((r) => r.data)
  },
  qualityExportUrl(opts: { window?: string; strategy_code?: string } = {}) {
    const params = new URLSearchParams()
    if (opts.window) params.set('window', opts.window)
    if (opts.strategy_code) params.set('strategy_code', opts.strategy_code)
    const qs = params.toString()
    return `/api/v1/reports/quality/export.csv${qs ? `?${qs}` : ''}`
  },
  riskTrend(opts: { days?: number; material_types?: string[] } = {}, mock?: MockMode) {
    if (mock?.enabled) {
      const days = opts.days ?? 7
      const filterSeed = (opts.material_types ?? []).join(',')
      const points = buildRiskTrend({
        days,
        filtered: !!opts.material_types?.length,
        filterSeed,
        mockSeed: mock.seed,
      })
      return Promise.resolve({ days, points } satisfies RiskTrendResponse)
    }
    const params: Record<string, unknown> = { days: opts.days ?? 7 }
    if (opts.material_types && opts.material_types.length) {
      params.material_types = opts.material_types
    }
    return api
      .get<RiskTrendResponse>('/reports/risk/trend', { params })
      .then((r) => r.data)
  },
  riskDistribution(days = 7) {
    return api
      .get<RiskDistributionResponse>('/reports/risk/distribution', { params: { days } })
      .then((r) => r.data)
  },
  riskTopLabels(days = 7, limit = 5) {
    return api
      .get<TopRiskLabelsResponse>('/reports/risk/top-labels', { params: { days, limit } })
      .then((r) => r.data)
  },
  exportAuditUrl() {
    return '/api/v1/reports/audit/export.csv'
  },
}

export const alertsApi = {
  list(
    opts: { status?: 'open' | 'acknowledged' | 'all'; limit?: number; offset?: number } = {},
    mock?: MockMode,
  ) {
    if (mock?.enabled) {
      const status = opts.status ?? 'open'
      const limit = opts.limit ?? 50
      const items = getMockAlerts({ status, limit, mockSeed: mock.seed })
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        size: limit,
      } satisfies AlertPage)
    }
    return api
      .get<AlertPage>('/alerts', {
        params: {
          status: opts.status,
          limit: opts.limit ?? 50,
          offset: opts.offset ?? 0,
        },
      })
      .then((r) => r.data)
  },
  ack(_id: number, _note?: string, mock?: MockMode) {
    if (mock?.enabled) {
      // ack 在 mock 模式下仅返回占位：调用方使用本地 state 维护状态
      return Promise.resolve({
        id: _id,
        public_id: `mock-${_id}`,
        rule_code: 'reject_rate_high',
        severity: 'warn',
        metric: '拒绝率',
        window_start: new Date().toISOString(),
        window_end: new Date().toISOString(),
        observed_value: 0,
        threshold: 0,
        dimension: {},
        detail: {},
        status: 'acknowledged',
        ack_by: null,
        ack_at: new Date().toISOString(),
        ack_note: _note ?? null,
        notified: true,
        created_at: new Date().toISOString(),
      } satisfies AlertEventOut)
    }
    return api
      .post<AlertEventOut>(`/alerts/${_id}/ack`, { note: _note ?? null })
      .then((r) => r.data)
  },
}
