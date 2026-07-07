import { api } from './client'
import type {
  Page,
  Strategy,
  StrategyCreatePayload,
  StrategyUpdatePayload,
  StrategyValidateResult,
} from '@/types/domain'

export const strategiesApi = {
  list(params?: { page?: number; size?: number; q?: string; scope?: 'default' | 'general' }) {
    return api.get<Page<Strategy>>('/strategies', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<Strategy>(`/strategies/${id}`).then((r) => r.data)
  },
  create(payload: StrategyCreatePayload) {
    const { application, services, ...rest } = payload
    const body = {
      ...rest,
      services: services ?? [],
      definition: {
        ...(rest.definition ?? {}),
        ...(application ? { application } : {}),
        ...(services && services.length > 0 ? { services } : {}),
      },
    }
    return api.post<Strategy>('/strategies', body).then((r) => r.data)
  },
  update(id: number, payload: StrategyUpdatePayload) {
    return api.patch<Strategy>(`/strategies/${id}`, payload).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete(`/strategies/${id}`).then(() => undefined as void)
  },
  duplicate(id: number, name?: string) {
    return api
      .post<Strategy>(`/strategies/${id}/duplicate`, { name })
      .then((r) => r.data)
  },
  validate(id: number) {
    return api
      .post<StrategyValidateResult>(`/strategies/${id}/validate`)
      .then((r) => r.data)
  },
}