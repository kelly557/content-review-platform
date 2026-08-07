import { api } from './client'
import type { Page, Service, ServiceScope, ServiceCreatePayload, ServiceUpdatePayload } from '@/types/domain'

export const servicesApi = {
  list(params?: {
    page?: number
    size?: number
    scope?: ServiceScope
    q?: string
    category_id?: number
    category_ids?: number[]
  }) {
    return api.get<Page<Service>>('/services', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<Service>(`/services/${id}`).then((r) => r.data)
  },
  create(payload: ServiceCreatePayload) {
    return api.post<Service>('/services', payload).then((r) => r.data)
  },
  update(id: number, payload: ServiceUpdatePayload) {
    return api.put<Service>(`/services/${id}`, payload).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete(`/services/${id}`).then(() => undefined as void)
  },
}