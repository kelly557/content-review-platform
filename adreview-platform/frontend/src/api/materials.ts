import { api } from './client'
import type {
  Material,
  MaterialListItem,
  MaterialCreatePayload,
  MaterialVersion,
  Page,
  WorkflowTemplate,
} from '@/types/domain'

export interface BatchUploadItemResult {
  index: number
  ok: boolean
  filename?: string | null
  material?: Material | null
  error?: string | null
}

export interface BatchUploadResponse {
  total: number
  succeeded: number
  failed: number
  items: BatchUploadItemResult[]
}

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
  batchUpload(
    files: File[],
    onProgress?: (percent: number) => void,
  ): Promise<BatchUploadResponse> {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f, f.name))
    return api
      .post<BatchUploadResponse>('/materials/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (!onProgress || !e.total) return
          const pct = Math.min(99, Math.round((e.loaded * 100) / e.total))
          onProgress(pct)
        },
      })
      .then((r) => {
        onProgress?.(100)
        return r.data
      })
  },
  submit(materialId: number, payload?: { task_name?: string; skip_machine_review?: boolean }) {
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
