import { api } from './client'
import type { OverviewStats, User } from '@/types/domain'

export const reportsApi = {
  overview() {
    return api.get<OverviewStats>('/reports/overview').then((r) => r.data)
  },
  exportAuditUrl() {
    return '/api/v1/reports/audit/export.csv'
  },
}

export const usersApi = {
  list() {
    return api.get<User[]>('/users').then((r) => r.data)
  },
}
