import { api } from './client'
import type {
  KnowledgeDocument,
  KnowledgeDocumentCreate,
  KnowledgeDocumentListItem,
  KnowledgeDocumentUpdate,
  KnowledgeDocumentVersion,
  Page,
} from '@/types/domain'

export const knowledgeDocumentsApi = {
  list(params?: {
    page?: number
    size?: number
    q?: string
    tag?: string
    source_type?: string
    status?: string
    include_deleted?: boolean
  }) {
    return api
      .get<Page<KnowledgeDocumentListItem>>('/knowledge-documents', { params })
      .then((r) => r.data)
  },
  get(id: number) {
    return api.get<KnowledgeDocument>(`/knowledge-documents/${id}`).then((r) => r.data)
  },
  create(body: KnowledgeDocumentCreate) {
    return api.post<KnowledgeDocument>('/knowledge-documents', body).then((r) => r.data)
  },
  update(id: number, body: KnowledgeDocumentUpdate) {
    return api
      .patch<KnowledgeDocument>(`/knowledge-documents/${id}`, body)
      .then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ id: number; is_deleted: boolean }>(`/knowledge-documents/${id}`).then(
      (r) => r.data,
    )
  },
  upload(
    file: File,
    fields: {
      title?: string
      code?: string
      description?: string | null
      tags?: string[]
      issued_at?: string | null
      status?: string
    } = {},
  ) {
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(fields).forEach(([k, v]) => {
      if (v === undefined || v === null) return
      if (Array.isArray(v)) {
        v.forEach((item) => fd.append(k, String(item)))
      } else {
        fd.append(k, String(v))
      }
    })
    return api
      .post<KnowledgeDocument>('/knowledge-documents/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  registerUrl(body: KnowledgeDocumentCreate) {
    return api
      .post<KnowledgeDocument>('/knowledge-documents/register-url', body)
      .then((r) => r.data)
  },
  listVersions(id: number) {
    return api
      .get<KnowledgeDocumentVersion[]>(`/knowledge-documents/${id}/versions`)
      .then((r) => r.data)
  },
  uploadVersion(id: number, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return api
      .post<KnowledgeDocumentVersion>(`/knowledge-documents/${id}/versions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  downloadUrl(id: number, versionId?: number) {
    const q = versionId ? `?version_id=${versionId}` : ''
    return `/api/v1/knowledge-documents/${id}/download${q}`
  },
}
