import { api } from './client'
import type {
  Page,
  Tag,
  TagCategory,
  TagCreate,
  TagDomain,
  TagSource,
  TagStatus,
  TagSummary,
  TagUpdate,
} from '@/types/domain'

export interface TagListParams {
  page?: number
  size?: number
  domain?: TagDomain
  category?: TagCategory
  status?: TagStatus
  source?: TagSource
  jurisdiction?: string[]
  industry?: string[]
  channel?: string[]
  q?: string
}

export const tagsApi = {
  list(params: TagListParams = {}) {
    return api
      .get<Page<TagSummary>>('/tags', {
        params,
        paramsSerializer: { indexes: null },
      })
      .then((r) => r.data)
  },
  get(id: string) {
    return api.get<Tag>(`/tags/${id}`).then((r) => r.data)
  },
  create(body: TagCreate) {
    return api.post<Tag>('/tags', body).then((r) => r.data)
  },
  update(id: string, body: TagUpdate) {
    return api.put<Tag>(`/tags/${id}`, body).then((r) => r.data)
  },
  remove(id: string) {
    return api.delete(`/tags/${id}`).then((r) => r.data)
  },
  activate(id: string) {
    return api.post<Tag>(`/tags/${id}/activate`).then((r) => r.data)
  },
  deprecate(id: string) {
    return api.post<Tag>(`/tags/${id}/deprecate`).then((r) => r.data)
  },
}