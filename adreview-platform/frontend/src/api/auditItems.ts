import type { AxiosError } from 'axios'
import { api } from './client'
import {
  MOCK_TEXT_RISK_ITEMS,
  type MockRiskItem,
} from '@/lib/riskPointMock'
import type {
  AuditItem,
  AuditItemCreate,
  AuditItemUpdate,
  MediaTypeKey,
  SuggestResponse,
} from '@/types/domain'

/** 接口 5xx / 网络错误时回退到 mock；其他状态码仍抛出原错。 */
function isFallbackError(err: unknown): boolean {
  const ax = err as AxiosError | undefined
  if (!ax) return true
  if (!ax.response) return true
  return ax.response.status >= 500
}

function asMockAuditItems(): AuditItem[] {
  return MOCK_TEXT_RISK_ITEMS.map((m: MockRiskItem) => ({
    id: m.id,
    package_code: 'text_audit_pro',
    code: `mock_${m.id}`,
    name_cn: m.name,
    small_category: null,
    aliases: [],
    description: null,
    sort_order: 0,
    is_enabled: true,
    is_builtin: false,
    point_count: 0,
    linked_libraries: [],
    active_small_model_version_id: null,
    active_model_version: null,
    active_large_model_id: null,
    active_large_model: null,
    knowledge_document_ids: [],
    low_threshold_min: null,
    medium_threshold_min: null,
    high_threshold_min: null,
    created_at: new Date().toISOString(),
    updated_at: null,
  }))
}

/** 暴露给前端页面：判断 auditPoint 是否来自 mock 兜底 */
export function isMockAuditPoint(p: { is_mock?: boolean } | null | undefined): boolean {
  return Boolean(p?.is_mock)
}

export const auditItemsApi = {
  list(packageCode: string, params?: { enabled?: boolean; q?: string }) {
    return api
      .get<AuditItem[]>(`/packages/${packageCode}/items`, { params })
      .then((r) => r.data)
      .catch((err: unknown) => {
        if (packageCode === 'text_audit_pro' && isFallbackError(err)) {
          return asMockAuditItems()
        }
        throw err
      })
  },
  listByMediaType(mediaType: MediaTypeKey) {
    return api
      .get<AuditItem[]>(`/packages/by-media-type/${mediaType}`)
      .then((r) => r.data)
  },
  suggest(packageCode: string, query: string, topK = 5) {
    return api
      .get<SuggestResponse>(`/packages/${packageCode}/items/suggest`, {
        params: { q: query, top_k: topK },
      })
      .then((r) => r.data)
  },
  create(packageCode: string, payload: AuditItemCreate) {
    return api
      .post<AuditItem>(`/packages/${packageCode}/items`, payload)
      .then((r) => r.data)
  },
  update(packageCode: string, itemId: number, payload: AuditItemUpdate) {
    return api
      .put<AuditItem>(`/packages/${packageCode}/items/${itemId}`, payload)
      .then((r) => r.data)
  },
  /** 通用规则「切换生效小模型版本」 */
  setActiveModelVersion(packageCode: string, itemId: number, versionId: number | null) {
    return api
      .put<AuditItem>(`/packages/${packageCode}/items/${itemId}`, {
        active_small_model_version_id: versionId,
      })
      .then((r) => r.data)
  },
  /** 个性化规则「切换生效大模型」(LLM，prompt 执行器) */
  setActiveLargeModel(packageCode: string, itemId: number, modelId: number | null) {
    return api
      .put<AuditItem>(`/packages/${packageCode}/items/${itemId}`, {
        active_large_model_id: modelId,
      })
      .then((r) => r.data)
  },
  /** 个性化规则「关联知识文档」全量替换 */
  setKnowledgeDocuments(packageCode: string, itemId: number, documentIds: number[]) {
    return api
      .put<AuditItem>(`/packages/${packageCode}/items/${itemId}`, {
        knowledge_document_ids: documentIds,
      })
      .then((r) => r.data)
  },
  remove(packageCode: string, itemId: number) {
    return api
      .delete(`/packages/${packageCode}/items/${itemId}`)
      .then(() => undefined as void)
  },
}
