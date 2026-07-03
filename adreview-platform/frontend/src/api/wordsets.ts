import { api } from './client'
import type { Page, WordSet, WordSetAction, WordSetGroup, WordSetKind } from '@/types/domain'

export const wordsetsApi = {
  list(params?: {
    page?: number
    size?: number
    group?: WordSetGroup
    action?: WordSetAction
    kind?: WordSetKind
    q?: string
  }) {
    return api.get<Page<WordSet>>('/wordsets', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<WordSet>(`/wordsets/${id}`).then((r) => r.data)
  },
  getWords(id: number) {
    return api.get<{ items: string[] }>(`/wordsets/${id}/words`).then((r) => r.data)
  },
  create(body: {
    name: string
    group: WordSetGroup
    action: WordSetAction
    words: string[]
    description?: string
  }) {
    return api.post<WordSet>('/wordsets', body).then((r) => r.data)
  },
  update(
    id: number,
    body: {
      name?: string
      group?: WordSetGroup
      action?: WordSetAction
      description?: string
      is_active?: boolean
      words?: string[]
    },
  ) {
    return api.put<WordSet>(`/wordsets/${id}`, body).then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/wordsets/${id}`).then((r) => r.data)
  },
  toggleIgnore(id: number, serviceCode: string, enabled: boolean) {
    return api
      .post<{ ignored_services: string[] }>(`/wordsets/${id}/ignore`, {
        service_code: serviceCode,
        enabled,
      })
      .then((r) => r.data)
  },
}
