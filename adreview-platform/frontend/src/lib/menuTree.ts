import type { MenuNode, MenuPermissionRow } from '@/types/role'

export const MENU_TREE: MenuNode[] = [
  { key: 'overview', label: '总览', permissions: ['view'] },
  { key: 'tasks', label: '审核任务', permissions: ['view', 'edit', 'delete'] },
  { key: 'triggers', label: '自动审核', permissions: ['view', 'edit', 'delete'] },
  { key: 'materials', label: '素材库', permissions: ['view', 'edit', 'delete'] },
  {
    key: 'strategies',
    label: '审核策略',
    children: [
      { key: 'strategies-list', label: '策略管理', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  {
    key: 'resources',
    label: '资源库',
    children: [
      { key: 'resources-words', label: '词库管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'resources-models', label: '模型库管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'resources-images', label: '图片库管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'resources-replies', label: '代答库管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'resources-knowledge', label: '知识库管理', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  { key: 'human-review-rules', label: '人工审核策略', permissions: ['view', 'edit', 'delete'] },
  { key: 'query', label: '数据查询', permissions: ['view', 'edit', 'delete'] },
  { key: 'reports', label: '数据报表', permissions: ['view'] },
  {
    key: 'account',
    label: '账号管理',
    children: [
      { key: 'admin-users', label: '用户管理', permissions: ['view', 'edit', 'delete'] },
      { key: 'admin-roles', label: '角色管理', permissions: ['view', 'edit', 'delete'] },
    ],
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