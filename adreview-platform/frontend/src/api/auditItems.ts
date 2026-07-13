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
  remove(packageCode: string, itemId: number) {
    return api
      .delete(`/packages/${packageCode}/items/${itemId}`)
      .then(() => undefined as void)
  },
}
