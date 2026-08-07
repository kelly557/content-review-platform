import { apiKeyMock } from '@/lib/mock/apiKeyMock'
import type { User } from '@/types/auth'

const PLATFORM_TENANT_ID = 'tnt_default'

export function isPlatformAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'root_admin') return true
  if (user.role !== 'superadmin') return false
  const tenantId = apiKeyMock.getUserTenant(user.id)
  return tenantId === PLATFORM_TENANT_ID
}

export function getCurrentUserTenantId(user: User | null | undefined): string {
  if (!user) return PLATFORM_TENANT_ID
  if (isPlatformAdmin(user)) return PLATFORM_TENANT_ID
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

export function getRoleDisplayLabel(user: User | null | undefined): string {
  if (!user) return ''
  if (user.role === 'root_admin') return '根管理员'
  if (isPlatformAdmin(user)) return '租户管理员'
  return ROLE_FALLBACK_LABELS[user.role] ?? user.role
}

const ROLE_FALLBACK_LABELS: Record<string, string> = {
  submitter: '提交者',
  reviewer: '审核员',
  mlr: 'MLR 专家',
  staff: '业务员',
  admin: '管理员',
  superadmin: '超级管理员',
  root_admin: '根管理员',
}
