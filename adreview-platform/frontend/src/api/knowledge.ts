import { api } from './client'
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentListResponse,
  KnowledgeDocumentSummary,
  KnowledgeDocumentStatus,
  KnowledgeExtraction,
  KnowledgeImportRequest,
  KnowledgeImportResult,
  KnowledgeScope,
} from '@/types/domain'
import type { TagDomain } from '@/types/domain'

export interface KnowledgeListParams {
  page?: number
  size?: number
  domain?: TagDomain
  status?: KnowledgeDocumentStatus
  q?: string
}

export const knowledgeApi = {
  list(params: KnowledgeListParams = {}) {
    return api
      .get<KnowledgeDocumentListResponse>('/knowledge/documents', { params })
      .then((r) => r.data)
  },

  get(id: string) {
    return api
      .get<KnowledgeDocumentDetail>(`/knowledge/documents/${id}`)
      .then((r) => r.data)
  },

  async upload(input: {
    title: string
    domain: TagDomain
    scope: KnowledgeScope
    tagIds: string[]
    targetServiceCode?: string
    file: File
  }): Promise<KnowledgeDocumentDetail> {
    const fd = new FormData()
    fd.append('title', input.title)
    fd.append('domain', input.domain)
    fd.append('scope', input.scope)
    fd.append('tag_ids', input.tagIds.join(','))
    if (input.targetServiceCode) fd.append('target_service_code', input.targetServiceCode)
    fd.append('file', input.file)
    const { data } = await api.post<KnowledgeDocumentDetail>(
      '/knowledge/documents',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return data
  },

  remove(id: string) {
    return api.delete(`/knowledge/documents/${id}`).then(() => undefined as void)
  },

  extract(documentId: string, force = false) {
    return api
      .post<KnowledgeExtraction>(
        `/knowledge/documents/${documentId}/extract`,
        { force },
      )
      .then((r) => r.data)
  },

  getExtraction(extractionId: string) {
    return api
      .get<KnowledgeExtraction>(`/knowledge/extractions/${extractionId}`)
      .then((r) => r.data)
  },

  patchItem(itemId: string, patch: Partial<{
    name_cn: string
    aliases: string[]
    description: string
    sort_order: number
    selected: boolean
  }>) {
    return api.patch(`/knowledge/extraction-items/${itemId}`, patch).then((r) => r.data)
  },

  patchPoint(pointId: string, patch: Partial<{
    label_cn: string
    description: string
    judgment_logic: { type: string; expr: string; params: Record<string, unknown> }
    judgment_rule: string
    judgment_basis: string
    risk_level: '低风险' | '中风险' | '高风险'
    medium_threshold: number
    high_threshold: number
    scope_text: string
    selected: boolean
  }>) {
    return api.patch(`/knowledge/extraction-points/${pointId}`, patch).then((r) => r.data)
  },

  importSelected(extractionId: string, body: KnowledgeImportRequest) {
    return api
      .post<KnowledgeImportResult>(
        `/knowledge/extractions/${extractionId}/import`,
        body,
      )
      .then((r) => r.data)
  },
}

export type { KnowledgeDocumentSummary }