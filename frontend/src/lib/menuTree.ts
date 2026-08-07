import type { MenuNode, MenuPermissionRow } from '@/types/role'

export const MENU_TREE: MenuNode[] = [
  { key: 'overview', label: '总览', permissions: ['view'] },
  { key: 'online-review', label: '在线审核', permissions: ['view', 'edit', 'delete'] },
  {
    key: 'strategies',
    label: '审核策略',
    children: [
      { key: 'strategies-list', label: '策略管理', permissions: ['view', 'edit', 'delete'] },
      {
        key: 'strategies-agents',
        label: '审核智能体',
        permissions: ['view', 'edit', 'delete'],
      },
    ],
  },
  {
    key: 'resources',
    label: '资源库',
    children: [
      { key: 'resources-words-system', label: '词库管理-系统通用', permissions: ['view'] },
      { key: 'resources-words-custom', label: '词库管理-自定义', permissions: ['view', 'edit', 'delete'] },
      { key: 'resources-replies-system', label: '代答库管理-系统通用', permissions: ['view'] },
      { key: 'resources-replies-custom', label: '代答库管理-自定义', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  { key: 'query', label: '数据查询', permissions: ['view', 'edit'] },
  { key: 'reports', label: '数据报表', permissions: ['view', 'edit'] },
  {
    key: 'account',
    label: '账号管理',
    children: [
      { key: 'admin-users', label: '用户管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'admin-roles', label: '角色管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'admin-permissions', label: '权限管理', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  {
    key: 'system-models',
    label: '模型管理',
    permissions: ['view'],
    children: [
      { key: 'admin-models-large', label: '大模型', permissions: ['view', 'edit', 'delete'] },
      { key: 'admin-models-small', label: '小模型', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  {
    key: 'system-tags',
    label: '标签管理',
    permissions: ['view', 'edit', 'delete'],
  },
]

export function flattenMenuForTable(): MenuPermissionRow[] {
  const rows: MenuPermissionRow[] = []
  for (const n1 of MENU_TREE) {
    rows.push({ level1: n1.key, level2: '__root__', menuNode: n1 })
    if (n1.children) {
      for (const n2 of n1.children) {
        rows.push({ level1: n1.key, level2: n2.key, menuNode: n2, parent: n1 })
      }
    }
  }
  return rows
}