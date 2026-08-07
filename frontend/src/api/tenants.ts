import { api } from './client'
import type { Tenant, TenantCreateInput, TenantUpdateInput } from '@/types/tenant'

export const tenantsApi = {
  list() {
    return api.get<Tenant[]>('/admin/tenants').then((r) => r.data)
  },
  create(body: TenantCreateInput) {
    return api.post<Tenant>('/admin/tenants', body).then((r) => r.data)
  },
  update(id: number, body: TenantUpdateInput) {
    return api.patch<Tenant>(`/admin/tenants/${id}`, body).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ ok: boolean; id: number }>(`/admin/tenants/${id}`).then((r) => r.data)
  },
}
