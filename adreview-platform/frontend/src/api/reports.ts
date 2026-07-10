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

export const reportsApi = {
  overview(window: string = '7d') {
    return api
      .get<OverviewStats>('/reports/overview', { params: { window } })
      .then((r) => r.data)
  },
  trend(opts: { metric?: TrendMetric; window?: string; granularity?: string } = {}) {
    return api
      .get<TrendResponse>('/reports/trend', {
        params: {
          metric: opts.metric ?? 'reject_rate',
          window: opts.window ?? '7d',
          granularity: opts.granularity,
        },
      })
      .then((r) => r.data)
  },
  anomaly(window: string = '1h') {
    return api
      .get<AnomalyResponse>('/reports/anomaly', { params: { window } })
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
  riskTrend(days = 7) {
    return api
      .get<RiskTrendResponse>('/reports/risk/trend', { params: { days } })
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
  list(opts: { status?: 'open' | 'acknowledged' | 'all'; limit?: number; offset?: number } = {}) {
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
  ack(id: number, note?: string) {
    return api
      .post<AlertEventOut>(`/alerts/${id}/ack`, { note: note ?? null })
      .then((r) => r.data)
  },
}