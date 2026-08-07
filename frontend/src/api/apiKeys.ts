import { api } from './client'
import type {
  ApiKey,
  ApiKeyCreateInput,
  ApiKeyCreated,
  ApiKeyListParams,
} from '@/types/apiKey'

export const apiKeysApi = {
  list(params: ApiKeyListParams = {}) {
    return api.get<ApiKey[]>('/admin/api-keys', { params }).then((r) => r.data)
  },
  create(body: ApiKeyCreateInput) {
    return api.post<ApiKeyCreated>('/admin/api-keys', body).then((r) => r.data)
  },
  revoke(id: number) {
    return api.post<ApiKey>(`/admin/api-keys/${id}/revoke`).then((r) => r.data)
  },
  rotate(id: number) {
    return api.post<ApiKeyCreated>(`/admin/api-keys/${id}/rotate`).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ ok: boolean; id: number }>(`/admin/api-keys/${id}`).then((r) => r.data)
  },
}
