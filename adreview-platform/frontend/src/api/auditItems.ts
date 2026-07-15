import { api } from './client'
import type {
  AuditItem,
  AuditItemCreate,
  AuditItemUpdate,
  MediaTypeKey,
  SuggestResponse,
} from '@/types/domain'

export const auditItemsApi = {
  list(packageCode: string, params?: { enabled?: boolean; q?: string }) {
    return api
      .get<AuditItem[]>(`/packages/${packageCode}/items`, { params })
      .then((r) => r.data)
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
  /** 个性化规则「切换生效大模型版本」(LLM，prompt 执行器) */
  setActiveLargeModelVersion(packageCode: string, itemId: number, versionId: number | null) {
    return api
      .put<AuditItem>(`/packages/${packageCode}/items/${itemId}`, {
        active_large_model_version_id: versionId,
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
