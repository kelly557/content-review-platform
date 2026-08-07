import { apiKeyMock } from '@/lib/mock/apiKeyMock'
import type { User } from '@/types/auth'

export function isPlatformAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.role === 'superadmin' || user.role === 'root_admin'
}

export function getCurrentUserTenantId(user: User | null | undefined): string {
  if (!user) return 'tnt_default'
  if (isPlatformAdmin(user)) return 'tnt_default'
  return apiKeyMock.getUserTenant(user.id)
}

export function canManageAllTenants(user: User | null | undefined): boolean {
  return isPlatformAdmin(user)
}

export function getCurrentUserTenantCode(user: User | null | undefined): string | null {
  if (!user || isPlatformAdmin(user)) return null
  const tid = apiKeyMock.getUserTenant(user.id)
  const tn = apiKeyMock.getTenantByIdSync(tid)
  return tn?.code ?? null
}
