/**
 * 共享权限判定工具。
 *
 * 设计原则（参考 docs/design/account-permissions.md）：
 * - superadmin = platform operator，隐式拥有 admin 的所有权限
 * - 各页面调用集中的 helper，不散落 user?.role === 'xxx'
 */
import type { User, UserRole } from '@/types/auth'

/** superadmin / root_admin 隐式为 admin */
export const isAdminRole = (role: UserRole | undefined | null): boolean =>
  role === 'admin' || role === 'superadmin' || role === 'root_admin'

/** 平台 superadmin / root_admin 专属（不能被 admin 冒充） */
export const isSuperadminOnly = (role: UserRole | undefined | null): boolean =>
  role === 'superadmin' || role === 'root_admin'

/** 可创建审核任务：reviewer / mlr / admin / superadmin */
export const canCreateTask = (user: User | null | undefined): boolean => {
  const r = user?.role
  return r === 'reviewer' || r === 'mlr' || isAdminRole(r)
}

/** 可编辑策略/触发器/库等后台：admin / superadmin */
export const canManageBackend = (user: User | null | undefined): boolean =>
  isAdminRole(user?.role)

/** 可作为 reviewer/mlr/admin 处理任务 */
export const canHandleTask = (user: User | null | undefined): boolean => {
  const r = user?.role
  return r === 'reviewer' || r === 'mlr' || isAdminRole(r)
}

/** 可取消任务：admin / superadmin / 提交者本人 */
export const canCancelTask = (
  user: User | null | undefined,
  isSubmitter: boolean,
): boolean => isAdminRole(user?.role) || isSubmitter

/** 可处置批注：admin / superadmin / 作者本人 */
export const canResolveAnnotation = (
  user: User | null | undefined,
  authorId: number,
): boolean => isAdminRole(user?.role) || user?.id === authorId