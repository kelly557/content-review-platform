import { api } from './client'
import type {
  AlertEventOut,
  AlertPage,
  AlertRootCauseResponse,
  AlertsListQuery,
  AnomalyQuery,
  AnomalyResponse,
  OverviewStats,
  QualityResponse,
  RiskDistributionBucket,
  RiskTimeseriesPoint,
  RiskTrendAppliedFilters,
  RiskTrendGranularity,
  RiskTrendOptionsResponse,
  TopRiskLabelItem,
  TrendMetric,
  TrendResponse,
} from '@/types/domain'

export interface RiskTrendResponse {
  granularity: RiskTrendGranularity
  window_start: string
  window_end: string
  applied: RiskTrendAppliedFilters
  points: RiskTimeseriesPoint[]
}

export interface RiskTrendQuery {
  window?: string
  start?: string
  end?: string
  granularity?: RiskTrendGranularity
  modalities?: string[]
  strategy_codes?: string[]
  account_ids?: string[]
  ips?: string[]
  channels?: string[]
  risk_label_paths?: string[]
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

export const reportsApi = {
  overview(opts: WindowOpts | string = '7d') {
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
  ) {
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
  anomaly(opts: AnomalyQuery | string = {}) {
    const q: AnomalyQuery = typeof opts === 'string' ? { window: '1h' } : opts
    const params: Record<string, unknown> = {}
    if (q.start && q.end) {
      params.start = q.start
      params.end = q.end
    } else {
      params.window = q.window ?? '1h'
    }
    if (q.granularity) params.granularity = q.granularity
    if (q.modalities?.length) params.modalities = q.modalities
    if (q.strategy_codes?.length) params.strategy_codes = q.strategy_codes
    if (q.channels?.length) params.channels = q.channels
    if (q.account_ids?.length) params.account_ids = q.account_ids
    if (q.ips?.length) params.ips = q.ips
    if (q.risk_label_paths?.length) params.risk_label_paths = q.risk_label_paths
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
  riskTrend(opts: RiskTrendQuery = {}) {
    const params: Record<string, unknown> = {}
    if (opts.start && opts.end) {
      params.start = opts.start
      params.end = opts.end
    } else {
      params.window = opts.window ?? '7d'
    }
    if (opts.granularity) params.granularity = opts.granularity
    if (opts.modalities?.length) params.modalities = opts.modalities
    if (opts.strategy_codes?.length) params.strategy_codes = opts.strategy_codes
    if (opts.account_ids?.length) params.account_ids = opts.account_ids
    if (opts.ips?.length) params.ips = opts.ips
    if (opts.channels?.length) params.channels = opts.channels
    if (opts.risk_label_paths?.length) params.risk_label_paths = opts.risk_label_paths
    return api
      .get<RiskTrendResponse>('/reports/risk/trend', { params })
      .then((r) => r.data)
  },
  riskTrendOptions() {
    return api
      .get<RiskTrendOptionsResponse>('/reports/risk-trend/options')
      .then((r) => r.data)
  },
  riskDistribution(days = 7) {
    return api
      .get<RiskDistributionResponse>('/reports/risk/distribution', { params: { days } })
      .then((r) => r.data)
  },
  riskTopLabels(
    opts:
      | number
      | {
          window?: string
          start?: string
          end?: string
          granularity?: RiskTrendGranularity
          modalities?: string[]
          strategy_codes?: string[]
          channels?: string[]
          account_ids?: string[]
          ips?: string[]
          risk_label_paths?: string[]
          dimension?: 'category' | 'item' | 'point'
          limit?: number
        },
    limit?: number,
  ): Promise<TopRiskLabelsResponse> {
    // Backward-compatible form: riskTopLabels(days, limit) — used by RiskProfileTab.
    if (typeof opts === 'number') {
      const days = opts
      const lim = limit ?? 5
      return api
        .get<TopRiskLabelsResponse>('/reports/risk/top-labels', { params: { days, limit: lim } })
        .then((r) => r.data)
    }
    const objOpts = opts
    const params: Record<string, unknown> = {}
    if (objOpts.start && objOpts.end) {
      params.start = objOpts.start
      params.end = objOpts.end
    } else if (objOpts.window) {
      params.window = objOpts.window
    }
    if (objOpts.granularity) params.granularity = objOpts.granularity
    if (objOpts.modalities?.length) params.modalities = objOpts.modalities
    if (objOpts.strategy_codes?.length) params.strategy_codes = objOpts.strategy_codes
    if (objOpts.channels?.length) params.channels = objOpts.channels
    if (objOpts.account_ids?.length) params.account_ids = objOpts.account_ids
    if (objOpts.ips?.length) params.ips = objOpts.ips
    if (objOpts.risk_label_paths?.length) params.risk_label_paths = objOpts.risk_label_paths
    if (objOpts.dimension) params.dimension = objOpts.dimension
    if (objOpts.limit) params.limit = objOpts.limit
    return api
      .get<TopRiskLabelsResponse>('/reports/risk/top-labels', { params })
      .then((r) => r.data)
  },
  exportAuditUrl() {
    return '/api/v1/reports/audit/export.csv'
  },
}

export const alertsApi = {
  list(opts: AlertsListQuery = {}) {
    const params: Record<string, unknown> = {
      status: opts.status,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }
    if (opts.start && opts.end) {
      params.start = opts.start
      params.end = opts.end
    } else if (opts.window) {
      params.window = opts.window
    }
    if (opts.modalities?.length) params.modalities = opts.modalities
    if (opts.strategy_codes?.length) params.strategy_codes = opts.strategy_codes
    if (opts.channels?.length) params.channels = opts.channels
    if (opts.account_ids?.length) params.account_ids = opts.account_ids
    if (opts.ips?.length) params.ips = opts.ips
    if (opts.risk_label_paths?.length) params.risk_label_paths = opts.risk_label_paths
    return api
      .get<AlertPage>('/alerts', { params })
      .then((r) => r.data)
  },
  ack(id: number, note?: string) {
    return api
      .post<AlertEventOut>(`/alerts/${id}/ack`, { note: note ?? null })
      .then((r) => r.data)
  },
  detail(alertId: number) {
    return api
      .get<AlertRootCauseResponse>(`/alerts/${alertId}/root-cause`)
      .then((r) => r.data)
  },
}
