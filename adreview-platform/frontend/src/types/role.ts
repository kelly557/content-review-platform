export type PermissionKey = 'view' | 'edit' | 'delete'

export const PERMISSION_KEYS: PermissionKey[] = ['view', 'edit', 'delete']

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  view: '查看',
  edit: '编辑',
  delete: '删除',
}

export interface MenuNode {
  key: string
  label: string
  children?: MenuNode[]
  permissions?: PermissionKey[]
}

export interface MenuPermissionRow {
  level1: string
  level2: string
  menuNode: MenuNode
  parent?: MenuNode
}

export type MenuPermMap = Partial<Record<PermissionKey, boolean>>

export type RolePermissions = Record<string, Record<string, MenuPermMap>>

import type { UserRole } from './auth'

export interface RoleRow {
  id: number
  key: UserRole
  display_name: string
  description?: string | null
  is_active: boolean
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export interface RoleOption {
  key: UserRole
  display_name: string
  is_active: boolean
}

export interface RoleCreatePayload {
  key: UserRole
  display_name: string
  description?: string
  is_active?: boolean
}

export interface RoleUpdatePayload {
  display_name?: string
  description?: string
  is_active?: boolean
}

// key 格式: 小写字母开头, 后续仅小写字母/数字/下划线, 长度 1-32。
// 允许 key 不在 UserRole enum 内: admin 可以创建"自定义角色"元数据,
// 若要将该角色分配给用户, 仍需后端 dev 同步在 UserRole enum 添加同值。
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/
export const ROLE_KEY_MAX_LENGTH = 32

/** 校验 key 是否符合后端 Pydantic 规则 */
export function isValidRoleKey(key: string): boolean {
  return (
    key.length >= 1 &&
    key.length <= ROLE_KEY_MAX_LENGTH &&
    ROLE_KEY_PATTERN.test(key)
  )
}
