import { api } from './client'
import type {
  MaterialPackage,
  MaterialPackageListItem,
  MaterialPackageCreatePayload,
  MaterialPackageUpdatePayload,
  Page,
} from '@/types/domain'

export const packagesApi = {
  list(params?: {
    page?: number
    size?: number
    status?: string
    material_type?: string
    q?: string
    mine?: boolean
  }) {
    return api
      .get<Page<MaterialPackageListItem>>('/material-packages', { params })
      .then((r) => r.data)
  },

  get(id: number) {
    return api.get<MaterialPackage>(`/material-packages/${id}`).then((r) => r.data)
  },

  create(payload: MaterialPackageCreatePayload) {
    return api
      .post<MaterialPackage>('/material-packages', payload)
      .then((r) => r.data)
  },

  update(id: number, payload: MaterialPackageUpdatePayload) {
    return api
      .put<MaterialPackage>(`/material-packages/${id}`, payload)
      .then((r) => r.data)
  },

  delete(id: number) {
    return api.delete(`/material-packages/${id}`)
  },

  submit(
    id: number,
    payload?: {
      workflow_template_code?: string
      force_human_rules?: string[]
    },
  ) {
    return api
      .post<MaterialPackage>(`/material-packages/${id}/submit`, payload || {})
      .then((r) => r.data)
  },
}
