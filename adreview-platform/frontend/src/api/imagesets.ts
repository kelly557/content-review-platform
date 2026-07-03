import { api } from './client'
import type {
  ImageSet,
  ImageSetAction,
  ImageSetGroup,
  ImageSetItem,
  ImageSetKind,
  ImageSetListItem,
  ImageSetUploadResponse,
  Page,
} from '@/types/domain'

export const imagesetsApi = {
  list(params?: {
    page?: number
    size?: number
    group?: ImageSetGroup
    action?: ImageSetAction
    kind?: ImageSetKind
    q?: string
  }) {
    return api.get<Page<ImageSetListItem>>('/imagesets', { params }).then((r) => r.data)
  },
  get(id: number) {
    return api.get<ImageSet>(`/imagesets/${id}`).then((r) => r.data)
  },
  create(payload: {
    name: string
    group: ImageSetGroup
    action: ImageSetAction
    description?: string
  }) {
    return api.post<ImageSet>('/imagesets', payload).then((r) => r.data)
  },
  update(
    id: number,
    payload: {
      name?: string
      group?: ImageSetGroup
      action?: ImageSetAction
      description?: string
      is_active?: boolean
    },
  ) {
    return api.put<ImageSet>(`/imagesets/${id}`, payload).then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/imagesets/${id}`).then(() => undefined as void)
  },
  listItems(id: number, page = 1, size = 60) {
    return api
      .get<Page<ImageSetItem>>(`/imagesets/${id}/items`, { params: { page, size } })
      .then((r) => r.data)
  },
  uploadItems(id: number, files: File[]) {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return api
      .post<ImageSetUploadResponse>(`/imagesets/${id}/items`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  removeItem(setId: number, itemId: number) {
    return api
      .delete(`/imagesets/${setId}/items/${itemId}`)
      .then(() => undefined as void)
  },
}
