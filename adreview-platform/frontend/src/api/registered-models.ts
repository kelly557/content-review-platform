import { api } from './client'
import type {
  ArtifactUploadResponse,
  AuditPointEntry,
  LargeModelCategory,
  Page,
  RegisteredModel,
  RegisteredModelCreate,
  RegisteredModelListItem,
  RegisteredModelStatus,
  RegisteredModelUpdate,
  RegisteredModelValidationLog,
  RegisteredModelVersion,
  RegisteredModelVersionCreate,
  RegisteredProvider,
  RegisteredProviderCreate,
  RegisteredProviderDetail,
  RegisteredProviderOption,
  RegisteredProviderRotateApiKey,
  RegisteredProviderUpdate,
  ResourceCredential,
} from '@/types/domain'

export const registeredModelsApi = {
  list(params?: {
    page?: number
    size?: number
    q?: string
    kind?: 'large' | 'small'
    small_category?: string
    large_category?: LargeModelCategory
    modality?: string
    provider_id?: number
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
  precheck(params: {
    endpoint_url: string
    protocol?: string
    model_name?: string | null
    api_key?: string | null
    timeout?: number
  }) {
    return api
      .post<RegisteredModelValidationLog>('/registered-models/precheck', params)
      .then((r) => r.data)
  },
  precheckArtifact(body: {
    storage_key: string
    modality: string
    small_category: string
    config_points?: AuditPointEntry[] | null
  }) {
    return api
      .post<RegisteredModelValidationLog>('/registered-models/precheck-artifact', body)
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
    large_category?: LargeModelCategory
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
  large_category: LargeModelCategory | null
  modality: string | null
  provider_id: number | null
  model_name: string | null
  status: string
}

export const providersApi = {
  list(params?: { status?: string; q?: string }): Promise<RegisteredProvider[]> {
    return api.get<RegisteredProvider[]>('/providers', { params }).then((r) => r.data)
  },
  options(): Promise<RegisteredProviderOption[]> {
    return api.get<RegisteredProviderOption[]>('/providers/options').then((r) => r.data)
  },
  get(id: number): Promise<RegisteredProviderDetail> {
    return api.get<RegisteredProviderDetail>(`/providers/${id}`).then((r) => r.data)
  },
  create(body: RegisteredProviderCreate): Promise<RegisteredProviderDetail> {
    return api.post<RegisteredProviderDetail>('/providers', body).then((r) => r.data)
  },
  update(id: number, body: RegisteredProviderUpdate): Promise<RegisteredProvider> {
    return api.patch<RegisteredProvider>(`/providers/${id}`, body).then((r) => r.data)
  },
  rotateApiKey(id: number, body: RegisteredProviderRotateApiKey): Promise<RegisteredProvider> {
    return api.post<RegisteredProvider>(`/providers/${id}/api-key`, body).then((r) => r.data)
  },
  validate(id: number): Promise<{
    ok: boolean
    http_status: number | null
    latency_ms: number | null
    message: string
  }> {
    return api.post(`/providers/${id}/validate`, {}).then((r) => r.data)
  },
  archive(id: number): Promise<RegisteredProvider> {
    return api.post<RegisteredProvider>(`/providers/${id}/archive`, {}).then((r) => r.data)
  },
  delete(id: number): Promise<void> {
    return api.delete(`/providers/${id}`).then(() => undefined)
  },
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
