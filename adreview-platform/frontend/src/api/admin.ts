import { api } from './client'
import type { User } from '@/types/domain'

export const usersApi = {
  list() {
    return api.get<User[]>('/users').then((r) => r.data)
  },
}
