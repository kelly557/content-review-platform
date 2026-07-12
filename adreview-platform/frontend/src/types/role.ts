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