import { api } from './client'
import type {
  AuditPointRef,
  Library,
  LibraryBatchCreateRequest,
  LibraryBatchCreateResult,
  LibraryCreate,
  LibraryDeletePayload,
  LibraryDeleteResponse,
  LibraryImageUploadResponse,
  LibraryItem,
  LibraryItemBatchDeleteResponse,
  LibraryKind,
  LibraryListItem,
  LibraryType,
  LibraryUpdate,
  Page,
} from '@/types/domain'

export const librariesApi = {
  list(params?: {
    page?: number
    size?: number
    type?: LibraryType
    kind?: LibraryKind
    q?: string
    is_active?: boolean
    include_deleted?: boolean
    effective_only?: boolean
  }) {
    return api.get<Page<LibraryListItem>>('/libraries', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<Library>(`/libraries/${id}`).then((r) => r.data)
  },
  create(body: LibraryCreate) {
    return api.post<Library>('/libraries', body).then((r) => r.data)
  },
  update(id: number, body: LibraryUpdate) {
    return api.put<Library>(`/libraries/${id}`, body).then((r) => r.data)
  },
  delete(id: number, body: LibraryDeletePayload = {}) {
    return api
      .delete<LibraryDeleteResponse>(`/libraries/${id}`, { data: body })
      .then((r) => r.data)
  },
  references(id: number) {
    return api.get<AuditPointRef[]>(`/libraries/${id}/references`).then((r) => r.data)
  },
  toggleIgnore(id: number, serviceCode: string, enabled: boolean) {
    return api
      .post<{ ignored_services: string[] }>(`/libraries/${id}/ignore`, {
        service_code: serviceCode,
        enabled,
      })
      .then((r) => r.data)
  },

  listItems(id: number, params?: { page?: number; size?: number; keyword?: string }) {
    return api
      .get<Page<LibraryItem>>(`/libraries/${id}/items`, { params })
      .then((r) => r.data)
  },
  addItems(id: number, words: string[]) {
    return api
      .post<Page<LibraryItem>>(`/libraries/${id}/items`, { words })
      .then((r) => r.data)
  },
  updateItem(libraryId: number, itemId: number, word: string) {
    return api
      .put<LibraryItem>(`/libraries/${libraryId}/items/${itemId}`, { word })
      .then((r) => r.data)
  },
  deleteItem(libraryId: number, itemId: number) {
    return api
      .delete(`/libraries/${libraryId}/items/${itemId}`)
      .then(() => undefined as void)
  },
  batchDeleteItems(libraryId: number, itemIds: number[]) {
    return api
      .post<LibraryItemBatchDeleteResponse>(
        `/libraries/${libraryId}/items/batch-delete`,
        { item_ids: itemIds },
      )
      .then((r) => r.data)
  },
  importItems(libraryId: number, sourceLibraryId: number, itemIds: number[]) {
    return api
      .post<LibraryItemBatchDeleteResponse>(
        `/libraries/${libraryId}/items/import`,
        { source_library_id: sourceLibraryId, item_ids: itemIds },
      )
      .then((r) => r.data)
  },

  uploadImages(id: number, files: File[]) {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return api
      .post<LibraryImageUploadResponse>(`/libraries/${id}/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  uploadWordsTxt(id: number, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return api
      .post<{ added: number; skipped: number; total: number }>(
        `/libraries/${id}/items/upload`,
        fd,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      )
      .then((r) => r.data)
  },

  itemDownloadUrl(libraryId: number, itemId: number) {
    return `/api/v1/libraries/${libraryId}/items/${itemId}/download`
  },

  batchCreate(body: LibraryBatchCreateRequest) {
    return api
      .post<LibraryBatchCreateResult>('/libraries/batch-create', body)
      .then((r) => r.data)
  },
}