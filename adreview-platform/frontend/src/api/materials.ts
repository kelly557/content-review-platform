import { api } from './client'
import type {
  Material,
  MaterialListItem,
  MaterialCreatePayload,
  MaterialVersion,
  Page,
  WorkflowTemplate,
} from '@/types/domain'

export const materialsApi = {
  list(params?: { page?: number; size?: number; status?: string; q?: string; mine?: boolean; material_type?: string }) {
    return api.get<Page<MaterialListItem>>('/materials', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<Material>(`/materials/${id}`).then((r) => r.data)
  },
  create(payload: MaterialCreatePayload) {
    return api.post<Material>('/materials', payload).then((r) => r.data)
  },
  update(id: number, payload: Partial<MaterialCreatePayload>) {
    return api.patch<Material>(`/materials/${id}`, payload).then((r) => r.data)
  },
  uploadVersion(materialId: number, file: File, textBody?: string) {
    const fd = new FormData()
    fd.append('file', file)
    if (textBody) fd.append('text_body', textBody)
    return api
      .post<MaterialVersion>(`/materials/${materialId}/versions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  submit(materialId: number, payload?: { task_name?: string }) {
    return api
      .post<Material>(`/materials/${materialId}/submit`, payload || {})
      .then((r) => r.data)
  },
  downloadUrl(materialId: number, versionId: number) {
    return `/api/v1/materials/${materialId}/versions/${versionId}/download`
  },
}

export const workflowsApi = {
  templates() {
    return api.get<WorkflowTemplate[]>('/workflows/templates').then((r) => r.data)
  },
}
