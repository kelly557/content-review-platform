import { api } from './client'
import type {
  LibraryGroup,
  LibraryGroupCreate,
  LibraryGroupUpdate,
  Page,
} from '@/types/domain'

export const libraryGroupsApi = {
  list(params?: { page?: number; size?: number; q?: string; include_deleted?: boolean }) {
    return api.get<Page<LibraryGroup>>('/library-groups', { params }).then((r) => r.data)
  },
  create(body: LibraryGroupCreate) {
    return api.post<LibraryGroup>('/library-groups', body).then((r) => r.data)
  },
  update(id: number, body: LibraryGroupUpdate) {
    return api.put<LibraryGroup>(`/library-groups/${id}`, body).then((r) => r.data)
  },
  remove(id: number) {
    return api.delete(`/library-groups/${id}`).then(() => undefined as void)
  },
}