import { api } from './client'
import type {
  WorkflowTemplate,
  WorkflowTemplateCreate,
  WorkflowTemplateUpdate,
} from '@/types/domain'

export const workflowsApi = {
  list(params: { prefix?: string; include_inactive?: boolean } = {}) {
    return api
      .get<WorkflowTemplate[]>('/workflows/templates', {
        params: { ...params, _t: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      })
      .then((r) => r.data)
  },
  get(id: number) {
    return api.get<WorkflowTemplate>(`/workflows/templates/${id}`).then((r) => r.data)
  },
  create(body: WorkflowTemplateCreate) {
    return api
      .post<WorkflowTemplate>('/workflows/templates', body)
      .then((r) => r.data)
  },
  update(id: number, body: WorkflowTemplateUpdate) {
    return api
      .put<WorkflowTemplate>(`/workflows/templates/${id}`, body)
      .then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/workflows/templates/${id}`).then((r) => r.data)
  },
}