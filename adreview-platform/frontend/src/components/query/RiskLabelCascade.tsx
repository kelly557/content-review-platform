import { useMemo } from 'react'
import { Cascader } from 'antd'
import type { RiskTaxonomyNode } from '@/types/domain'

interface Props {
  taxonomy: RiskTaxonomyNode[]
  value: string[]
  onChange: (paths: string[]) => void
  placeholder?: string
}

interface OptionType {
  value: string
  label: string
  isLeaf?: boolean
  children?: OptionType[]
}

function toOptions(nodes: RiskTaxonomyNode[]): OptionType[] {
  return nodes.map((node) => {
    const kids = node.children ?? []
    return {
      value: node.path,
      label: node.label,
      children: kids.length ? toOptions(kids) : undefined,
      isLeaf: kids.length === 0,
    }
  })
}

function pathsToNested(paths: string[], taxonomy: RiskTaxonomyNode[]): string[][] {
  const byPath = new Map<string, string[]>()
  for (const node of taxonomy) {
    collectPaths(node, byPath)
  }
  const out: string[][] = []
  for (const p of paths) {
    out.push(byPath.get(p) ?? [p])
  }
  return out
}

function collectPaths(node: RiskTaxonomyNode, sink: Map<string, string[]>) {
  const kids = node.children ?? []
  if (kids.length === 0) {
    sink.set(node.path, [node.path])
    return
  }
  for (const child of kids) {
    collectPaths(child, sink)
  }
}

export default function RiskLabelCascade({
  taxonomy,
  value,
  onChange,
  placeholder = '风险类型 / 审核项 / 审核点',
}: Props) {
  const options = useMemo(() => toOptions(taxonomy), [taxonomy])
  const nestedValue = useMemo(
    () => pathsToNested(value, taxonomy),
    [value, taxonomy],
  )

  return (
    <Cascader
      multiple
      changeOnSelect
      expandTrigger="hover"
      value={nestedValue}
      options={options}
      onChange={(v) => {
        const leaves = (v as string[][])
          .map((arr) => arr[arr.length - 1])
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
        onChange(leaves)
      }}
      showCheckedStrategy={Cascader.SHOW_CHILD}
      placeholder={placeholder}
      style={{ width: '100%' }}
      maxTagCount="responsive"
      notFoundContent={taxonomy.length ? '暂无可选标签' : '暂无标签数据'}
    />
  )
}