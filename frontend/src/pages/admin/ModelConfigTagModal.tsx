import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Empty,
  Form,
  Modal,
  Select,
  Space,
  Tag,
  TreeSelect,
  Typography,
} from 'antd'
import type { TagTreeNode } from '@/types/domain'
import { buildTagPath } from '@/lib/tagUtils'
import { computeOccupancy } from '@/lib/configuredTagOccupancy'
import type { ConfiguredTagEntry } from '@/pages/admin/configuredTagTypes'

const { Text } = Typography

export type { ConfiguredTagEntry }

interface ConfigTagModelLike {
  id: number | string
  name: string
  discoveredTags?: string[]
  configuredTags?: ConfiguredTagEntry[]
}

interface Props {
  open: boolean
  onClose: () => void
  model: ConfigTagModelLike | null
  /** 所有模型,用于计算全局占用 */
  allModels: ConfigTagModelLike[]
  /** 真实业务标签树（tagsApi.tree()） */
  tagTree: TagTreeNode[]
  /** 返回 false 表示保存失败（保持弹窗打开） */
  onSave: (entry: ConfiguredTagEntry) => Promise<boolean> | boolean
}

interface TreeSelectNode {
  value: string
  title: string
  rawTitle: string
  level: number
  selectable: boolean
  disableCheckbox?: boolean
  children?: TreeSelectNode[]
}

function filterAndConvertTree(
  nodes: TagTreeNode[],
  occupiedByOther: Set<string>,
  occupiedBySelf: Set<string>,
): TreeSelectNode[] {
  const out: TreeSelectNode[] = []
  for (const n of nodes) {
    // 仅提供「已启用」的标签供绑定
    if (n.status !== 'active') continue
    if (n.level === 3) {
      if (occupiedByOther.has(n.id) || occupiedBySelf.has(n.id)) continue
      out.push({
        value: n.id,
        title: n.name,
        rawTitle: n.name,
        level: n.level,
        selectable: true,
        children: undefined,
      })
      continue
    }
    const filteredChildren = n.children?.length
      ? filterAndConvertTree(n.children, occupiedByOther, occupiedBySelf)
      : []
    if (filteredChildren.length === 0) continue
    out.push({
      value: n.id,
      title: n.name,
      rawTitle: n.name,
      level: n.level,
      selectable: false,
      disableCheckbox: true,
      children: filteredChildren,
    })
  }
  return out
}

export default function ModelConfigTagModal({
  open,
  onClose,
  model,
  allModels,
  tagTree,
  onSave,
}: Props) {
  const [form] = Form.useForm<{ discoveredTag: string; tagId: string }>()
  const [tagId, setTagId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      form.resetFields()
      setTagId(undefined)
    }
  }, [open, form])

  // 真实标签树上的 bound_model_id 占用（跨页面绑定的全局占用）
  const treeBound = useMemo(() => {
    const byOther = new Set<string>()
    const bySelf = new Set<string>()
    if (!model) return { byOther, bySelf }
    const walk = (nodes: TagTreeNode[]) => {
      for (const n of nodes) {
        if (n.level === 3 && n.bound_model_id != null) {
          if (String(n.bound_model_id) === String(model.id)) bySelf.add(n.id)
          else byOther.add(n.id)
        }
        if (n.children?.length) walk(n.children)
      }
    }
    walk(tagTree)
    return { byOther, bySelf }
  }, [tagTree, model])

  const occupancy = useMemo(() => {
    const base = model
      ? computeOccupancy(allModels, model.id)
      : { occupiedByOther: new Set<string>(), occupiedBySelf: new Set<string>() }
    for (const id of treeBound.byOther) base.occupiedByOther.add(id)
    for (const id of treeBound.bySelf) base.occupiedBySelf.add(id)
    return base
  }, [model, allModels, treeBound])

  const treeData = useMemo(
    () =>
      filterAndConvertTree(
        tagTree,
        occupancy.occupiedByOther,
        occupancy.occupiedBySelf,
      ),
    [tagTree, occupancy],
  )

  if (!model) return null

  const unconfiguredTags = (model.discoveredTags ?? []).filter(
    (t) => !(model.configuredTags ?? []).some((c) => c.discoveredTag === t),
  )

  const selectedTagPath = tagId ? buildTagPath(tagTree, tagId) : ''

  const handleSubmit = async () => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      const ok = await onSave({
        discoveredTag: v.discoveredTag,
        tagId: v.tagId,
        tagPath: buildTagPath(tagTree, v.tagId),
      })
      if (ok !== false) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space size={8} align="center">
          <span
            style={{
              display: 'inline-block',
              width: 3,
              height: 16,
              background: '#1677ff',
              borderRadius: 2,
            }}
          />
          <span>配置业务标签</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {model.name}
          </Text>
        </Space>
      }
      width={520}
      destroyOnClose
      okText="保存"
      cancelText="取消"
      onOk={handleSubmit}
      confirmLoading={saving}
      okButtonProps={{ disabled: unconfiguredTags.length === 0 }}
    >
      {unconfiguredTags.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="该模型的所有 discoveredTag 都已配置,无需新增。"
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 8 }}
          initialValues={{ discoveredTag: undefined, tagId: undefined }}
        >
          <Form.Item
            label="模型标签"
            name="discoveredTag"
            rules={[{ required: true, message: '请选择模型标签' }]}
          >
            <Select
              placeholder="请选择模型标签"
              options={unconfiguredTags.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>

          <Form.Item
            label="业务标签(三级)"
            name="tagId"
            rules={[{ required: true, message: '请选择三级业务标签' }]}
          >
            <TreeSelect
              placeholder="请选择三级业务标签"
              treeDefaultExpandAll
              treeData={treeData}
              showSearch
              treeNodeFilterProp="rawTitle"
              treeCheckable={false}
              value={tagId}
              onChange={(v) => {
                const next = (v as string | undefined) ?? undefined
                setTagId(next)
                form.setFieldValue('tagId', next)
              }}
              notFoundContent={
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="无可选标签"
                />
              }
              dropdownStyle={{ maxHeight: 360, overflow: 'auto' }}
              style={{ width: '100%' }}
            />
          </Form.Item>

          {selectedTagPath && (
            <Form.Item label="已选业务标签" style={{ marginBottom: 0 }}>
              <Tag color="blue">{selectedTagPath}</Tag>
            </Form.Item>
          )}
        </Form>
      )}
    </Modal>
  )
}
