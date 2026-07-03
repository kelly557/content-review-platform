import { api } from './client'
import type { Page, ServiceCategory, ServiceCategoryCreatePayload, ServiceCategoryUpdatePayload } from '@/types/domain'

export const serviceCategoriesApi = {
  list(params?: { page?: number; size?: number; q?: string }) {
    return api.get<Page<ServiceCategory>>('/service-categories', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<ServiceCategory>(`/service-categories/${id}`).then((r) => r.data)
  },
  create(payload: ServiceCategoryCreatePayload) {
    return api.post<ServiceCategory>('/service-categories', payload).then((r) => r.data)
  },
  update(id: number, payload: ServiceCategoryUpdatePayload) {
    return api.put<ServiceCategory>(`/service-categories/${id}`, payload).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete(`/service-categories/${id}`).then(() => undefined as void)
  },
}
