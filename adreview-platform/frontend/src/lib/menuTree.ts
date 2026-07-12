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
      { key: 'strategies-list', label: '策略列表', permissions: ['view', 'edit', 'delete'] },
      { key: 'strategies-image', label: '图片审核规则', permissions: ['view', 'edit', 'delete'] },
      { key: 'strategies-text', label: '文本审核规则', permissions: ['view', 'edit', 'delete'] },
    ],
  },
  {
    key: 'knowledge',
    label: '知识库',
    children: [
      { key: 'knowledge-words', label: '词库', permissions: ['view', 'edit', 'delete'] },
      { key: 'knowledge-images', label: '图片库', permissions: ['view', 'edit', 'delete'] },
      { key: 'knowledge-replies', label: '代答库', permissions: ['view', 'edit', 'delete'] },
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