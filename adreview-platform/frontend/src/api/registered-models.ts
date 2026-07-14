import { api } from './client'
import type {
  ArtifactUploadResponse,
  Page,
  RegisteredModel,
  RegisteredModelCreate,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredModelUpdate,
  RegisteredModelValidationLog,
  RegisteredModelVersion,
  RegisteredModelVersionCreate,
  ResourceCredential,
} from '@/types/domain'

export const registeredModelsApi = {
  list(params?: {
    page?: number
    size?: number
    q?: string
    kind?: 'large' | 'small'
    small_category?: string
    provider?: string
    status?: string
    include_deleted?: boolean
  }) {
    return api
      .get<Page<RegisteredModelListItem>>('/registered-models', { params })
      .then((r) => r.data)
  },
  get(id: number) {
    return api.get<RegisteredModel>(`/registered-models/${id}`).then((r) => r.data)
  },
  create(body: RegisteredModelCreate) {
    return api.post<RegisteredModel>('/registered-models', body).then((r) => r.data)
  },
  update(id: number, body: RegisteredModelUpdate) {
    return api
      .patch<RegisteredModel>(`/registered-models/${id}`, body)
      .then((r) => r.data)
  },
  delete(id: number) {
    return api
      .delete<{ id: number; is_deleted: boolean }>(`/registered-models/${id}`)
      .then((r) => r.data)
  },
  archive(id: number) {
    return api
      .post<RegisteredModel>(`/registered-models/${id}/archive`, {})
      .then((r) => r.data)
  },
  deactivate(id: number) {
    return api
      .post<RegisteredModel>(`/registered-models/${id}/deactivate`, {})
      .then((r) => r.data)
  },
  validate(id: number) {
    return api
      .post<{ ok: boolean; log: RegisteredModelValidationLog; status: RegisteredModelStatus }>(
        `/registered-models/${id}/validate`,
        {},
      )
      .then((r) => r.data)
  },
  listVersions(id: number) {
    return api
      .get<RegisteredModelVersion[]>(`/registered-models/${id}/versions`)
      .then((r) => r.data)
  },
  createVersion(id: number, body: RegisteredModelVersionCreate) {
    return api
      .post<RegisteredModelVersion>(`/registered-models/${id}/versions`, body)
      .then((r) => r.data)
  },
  activateVersion(id: number, versionId: number) {
    return api
      .post<RegisteredModelVersion>(
        `/registered-models/${id}/versions/${versionId}/activate`,
        {},
      )
      .then((r) => r.data)
  },
  listActiveModels(params?: {
    kind?: 'large' | 'small'
    small_category?: string
  }): Promise<ActiveModelOption[]> {
    return api
      .get<ActiveModelOption[]>('/registered-models/options', { params })
      .then((r) => r.data)
  },
  uploadArtifact(file: File): Promise<ArtifactUploadResponse> {
    const fd = new FormData()
    fd.append('file', file)
    return api
      .post<ArtifactUploadResponse>('/registered-models/upload-artifact', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  artifactDownloadUrl(modelId: number, versionId: number): string {
    // 直接拼 baseURL 前缀；走 axios 实例的 baseURL 不可用于原生 <a> 下载
    const base = (api.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
    return `${base}/registered-models/${modelId}/versions/${versionId}/artifact`
  },
}

export interface ActiveModelOption {
  id: number
  code: string
  name: string
  kind: 'large' | 'small'
  small_category: string | null
  provider: string | null
  model_name: string | null
  status: string
}

export const credentialsApi = {
  list() {
    return api.get<ResourceCredential[]>('/credentials').then((r) => r.data)
  },
  create(body: { name: string; provider?: string; token: string }) {
    return api.post<ResourceCredential>('/credentials', body).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ id: number; is_deleted: boolean }>(`/credentials/${id}`).then((r) => r.data)
  },
}
