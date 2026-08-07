import { useEffect, useMemo, useState } from 'react'
import { Empty, TreeSelect } from 'antd'
import { tagsApi } from '@/api/tags'
import type { TagTreeNode } from '@/types/domain'

interface Props {
  value?: string | null
  onChange?: (v: string | undefined) => void
  placeholder?: string
  disabled?: boolean
  allowClear?: boolean
  /** 哪些 level 可被选择 (默认: 一级 + 二级; 三级保留给模型绑定) */
  selectableLevels?: ReadonlyArray<1 | 2 | 3>
}

/**
 * 把 tags tree 渲染成 picker 可消费的 treeData,带以下特性:
 *  - 直接展示标签自身名 (不再拼一级前缀),靠 Antd TreeSelect 缩进体现层级
 *  - 一级 / 二级节点可选;三级节点 ``selectable: false`` 仅作上下文展示
 *    (按用户约定: 词库只能绑一/二级,三级保留给模型绑定)
 *  - 不可选节点置灰
 */
function buildTree(
  nodes: TagTreeNode[],
  selectableLevels: ReadonlyArray<1 | 2 | 3>,
): any[] {
  const out: any[] = []
  for (const n of nodes) {
    const isSelectable = (selectableLevels as readonly number[]).includes(n.level)

    const title = (
      <span style={{ color: isSelectable ? undefined : '#94A3B8' }}>
        {n.name}
      </span>
    )

    out.push({
      value: n.id,
      title,
      rawTitle: n.name,
      level: n.level,
      selectable: isSelectable,
      disableCheckbox: !isSelectable,
      children: n.children?.length
        ? buildTree(n.children, selectableLevels)
        : undefined,
    })
  }
  return out
}

export default function LibraryTagPicker({
  value,
  onChange,
  placeholder = '可选：绑定一/二级风险标签',
  disabled,
  allowClear = true,
  selectableLevels = [1, 2],
}: Props) {
  // 从后端加载真实标签树
  const [tree, setTree] = useState<TagTreeNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    tagsApi
      .tree()
      .then((t) => {
        if (!cancelled) setTree(t)
      })
      .catch(() => {
        // 加载失败留空树
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const treeData = useMemo(
    () => buildTree(tree, selectableLevels),
    [tree, selectableLevels],
  )

  if (loading) {
    return <TreeSelect loading placeholder="加载标签中…" style={{ width: '100%' }} />
  }
  if (!treeData.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标签" />
  }

  return (
    <div>
      <TreeSelect
        value={value ?? undefined}
        onChange={(v) => onChange?.(v === undefined ? undefined : (v as string))}
        placeholder={placeholder}
        disabled={disabled}
        allowClear={allowClear}
        // 默认全部展开 — 用户打开下拉就能看到完整的「一级 / 二级」级联,
        // 避免误以为只有一级可选项
        treeDefaultExpandAll={true}
        treeData={treeData}
        showSearch
        // 用原始 pathLabel 做过滤(不包含角标字符),体验更顺
        treeNodeFilterProp="rawTitle"
        treeCheckable={false}
        // 当节点 selectable=false 时, TreeSelect 在该节点上 click 不会选中,
        // 只会展开/折叠其 children。三级是只读上下文。
        style={{ width: '100%' }}
        notFoundContent={
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无可选标签" />
        }
        dropdownStyle={{ maxHeight: 360, overflow: 'auto' }}
      />
    </div>
  )
}
