import type { AxiosError } from 'axios'
import { api } from './client'
import {
  MOCK_TEXT_RISK_POINTS,
  type MockRiskPoint,
} from '@/lib/riskPointMock'
import type {
  AuditPoint,
  AuditPointBatchResult,
  AuditPointCreate,
  AuditPointUpdate,
} from '@/types/domain'

export interface ParsedAuditPoint {
  label_cn: string
  scope_text?: string
}

export interface DocumentParseResult {
  points: ParsedAuditPoint[]
  source_info?: string
}

function isFallbackError(err: unknown): boolean {
  const ax = err as AxiosError | undefined
  if (!ax) return true
  if (!ax.response) return true
  return ax.response.status >= 500
}

function asMockAuditPoints(): AuditPoint[] {
  return MOCK_TEXT_RISK_POINTS.map((m: MockRiskPoint) => ({
    id: m.id,
    package_code: 'text_audit_pro',
    item_id: m.item_id,
    code: `mock_${m.id}`,
    label: m.label,
    label_cn: m.label_cn,
    description: null,
    medium_threshold: 60,
    high_threshold: 90,
    scope_text: null,
    risk_level: m.risk_level ?? '中风险',
    is_enabled: m.is_enabled ?? true,
    is_builtin: false,
    custom_wordset_id: null,
    sort_order: 0,
    source_document_id: null,
    source_quote: null,
    source_line_no: null,
    is_mock: true,
    created_at: new Date().toISOString(),
    updated_at: null,
  }))
}

export const auditPointsApi = {
  list(
    packageCode: string,
    params?: { item_id?: number; enabled?: boolean },
  ) {
    return api
      .get<AuditPoint[]>(`/packages/${packageCode}/points`, { params })
      .then((r) => r.data)
      .catch((err: unknown) => {
        if (packageCode === 'text_audit_pro' && isFallbackError(err)) {
          return asMockAuditPoints()
        }
        throw err
      })
  },
  async get(packageCode: string, pointId: number): Promise<AuditPoint> {
    const list = await api
      .get<AuditPoint[]>(`/packages/${packageCode}/points`)
      .then((r) => r.data)
    const found = list.find((p) => p.id === pointId)
    if (!found) {
      throw new Error(`审核点不存在: ${pointId}`)
    }
    return found
  },
  create(packageCode: string, payload: AuditPointCreate) {
    return api
      .post<AuditPoint>(`/packages/${packageCode}/points`, payload)
      .then((r) => r.data)
  },
  createMany(
    packageCode: string,
    body: { item_id: number; points: AuditPointCreate[] },
  ) {
    return api
      .post<AuditPointBatchResult>(
        `/packages/${packageCode}/points/batch`,
        body,
      )
      .then((r) => r.data)
  },
  update(packageCode: string, pointId: number, payload: AuditPointUpdate) {
    return api
      .put<AuditPoint>(`/packages/${packageCode}/points/${pointId}`, payload)
      .then((r) => r.data)
  },
  remove(packageCode: string, pointId: number) {
    return api
      .delete(`/packages/${packageCode}/points/${pointId}`)
      .then(() => undefined as void)
  },
  reset(packageCode: string) {
    return api
      .post<{ items: AuditPoint[] }>(`/packages/${packageCode}/points/reset`)
      .then((r) => r.data)
  },
  parseDocument(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return api
      .post<DocumentParseResult>(`/points/parse-document`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
}
