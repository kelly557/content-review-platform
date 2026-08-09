import type { TagTreeNode } from '@/types/domain'

/**
 * 在业务标签树（三级）中按节点 id 查找，并返回「一级 / 二级 / 三级」全路径。
 * 找不到时返回空字符串。
 */
export function buildTagPath(tree: TagTreeNode[], id: string): string {
  const path: string[] = []
  function dfs(nodes: TagTreeNode[], trail: string[]): boolean {
    for (const n of nodes) {
      if (n.id === id) {
        path.push(...trail, n.name)
        return true
      }
      if (n.children?.length && dfs(n.children, [...trail, n.name])) {
        return true
      }
    }
    return false
  }
  dfs(tree, [])
  return path.join(' / ')
}
