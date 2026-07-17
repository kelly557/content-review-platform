import { api } from './client'
import type { User, UserRole } from '@/types/domain'

export interface UserCreatePayload {
  email: string
  full_name: string
  password: string
  role: UserRole
  is_active?: boolean
}

export interface UserUpdatePayload {
  full_name?: string
  role?: UserRole
  is_active?: boolean
}

export const usersApi = {
  list() {
    return api.get<User[]>('/users').then((r) => r.data)
  },
  create(body: UserCreatePayload) {
    return api.post<User>('/users', body).then((r) => r.data)
  },
  update(id: number, body: UserUpdatePayload) {
    return api.patch<User>(`/users/${id}`, body).then((r) => r.data)
  },
  delete(id: number) {
    return api.delete<{ ok: boolean; id: number }>(`/users/${id}`).then((r) => r.data)
  },
}
