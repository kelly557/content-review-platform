import type { User } from '@/types/auth'

// 平台租户：tenant_id 为 NULL 的用户（root_admin 或平台 superadmin）视为归属平台租户。
export const PLATFORM_TENANT_ID: number | null = null

// 平台租户管理员（platform admin）= root_admin。
// superadmin（含平台 superadmin）是超级管理员，拥有除租户管理外的所有权限，
// 不再被视为平台管理员。
export function isPlatformAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return user.role === 'root_admin'
}

export function getCurrentUserTenantId(user: User | null | undefined): number | null {
  if (!user) return PLATFORM_TENANT_ID
  if (isPlatformAdmin(user)) return PLATFORM_TENANT_ID
  return user.tenant_id ?? PLATFORM_TENANT_ID
}

export function canManageAllTenants(user: User | null | undefined): boolean {
  return isPlatformAdmin(user)
}

export function getCurrentUserTenantCode(
  user: User | null | undefined,
  tenants: { id: number; code: string }[] = [],
): string | null {
  if (!user || isPlatformAdmin(user)) return null
  const tid = user.tenant_id
  if (tid == null) return null
  return tenants.find((t) => t.id === tid)?.code ?? null
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
