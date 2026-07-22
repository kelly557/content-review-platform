import { api } from './client'

export type RiskCategory = {
  code: string
  label: string
  color: string
  sort_order: number
  is_builtin: boolean
  created_by_id: number | null
  created_at: string
  updated_at: string
}

export const riskCategoriesApi = {
  list(params?: { is_builtin?: boolean }) {
    return api.get<RiskCategory[]>('/risk-categories', { params }).then((r) => r.data)
  },
  create(body: { label: string }) {
    return api.post<RiskCategory>('/risk-categories', body).then((r) => r.data)
  },
  update(code: string, body: { label: string }) {
    return api.patch<RiskCategory>(`/risk-categories/${encodeURIComponent(code)}`, body).then((r) => r.data)
  },
  remove(code: string) {
    return api.delete(`/risk-categories/${encodeURIComponent(code)}`).then((r) => r.data)
  },
}
